const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Import custom service files
const firebase = require('./services/firebase');
const ollama = require('./services/ollama');
const wger = require('./services/wger');
const promptTemplates = require('./services/promptTemplates');

// Simple cache implementation
const cache = {
  nutritionData: null,
  lastLoaded: 0
};

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up middleware
app.use(cors());
app.use(express.json());

// Function to detect if a message is asking for nutrition information
function isNutritionQuery(message) {
  const messageLower = message.toLowerCase();
  
  // Patterns that indicate nutrition queries
  const nutritionPatterns = [
    /what(?:'s| is| are) the nutrition(?: information| facts| data)? (?:for|of) ([\w\s]+)/i,
    /nutrition(?: information| facts| data)? (?:for|of) ([\w\s]+)/i,
    /how many calories (?:are |is |does |in |)+([\w\s]+)/i,
    /(?:calories|protein|carbs|fat) in ([\w\s]+)/i,
    /what(?:'s| is| are) the (?:calories|protein|carbs|fat) (?:for|of|in) ([\w\s]+)/i,
    /tell me (?:about |the |)(?:nutrition|calories|macros) (?:for |of |in |)([\w\s]+)/i
  ];
  
  for (const pattern of nutritionPatterns) {
    if (pattern.test(messageLower)) {
      return true;
    }
  }
  
  return false;
}

// Function to extract meal name from nutrition query
function extractMealName(message) {
  const messageLower = message.toLowerCase();
  
  // Patterns to extract meal names
  const extractionPatterns = [
    /what(?:'s| is| are) the nutrition(?: information| facts| data)? (?:for|of) ([\w\s]+)/i,
    /nutrition(?: information| facts| data)? (?:for|of) ([\w\s]+)/i,
    /how many calories (?:are |is |does |in |)+([\w\s]+)/i,
    /(?:calories|protein|carbs|fat) in ([\w\s]+)/i,
    /what(?:'s| is| are) the (?:calories|protein|carbs|fat) (?:for|of|in) ([\w\s]+)/i,
    /tell me (?:about |the |)(?:nutrition|calories|macros) (?:for |of |in |)([\w\s]+)/i
  ];
  
  for (const pattern of extractionPatterns) {
    const match = messageLower.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  
  return null;
}

// Function to detect allergy-related questions
function isMealSafetyQuestion(message) {
  const messageLower = message.toLowerCase();
  
  const mealSafetyPatterns = [
    /can i (eat|have|consume|try) ([\w\s\-]+)(\?)?/i,
    /is ([\w\s\-]+) safe for me(\?)?/i,
    /should i avoid ([\w\s\-]+)(\?)?/i,
    /am i allergic to ([\w\s\-]+)(\?)?/i,
    /will ([\w\s\-]+) cause (an|a) (allergic reaction|allergy)(\?)?/i,
    /is it safe for me to eat ([\w\s\-]+)(\?)?/i,
    /is ([\w\s\-]+) ok with my allergies(\?)?/i
  ];
  
  for (const pattern of mealSafetyPatterns) {
    if (pattern.test(messageLower)) {
      return true;
    }
  }
  
  return false;
}

// Function to extract meal name from safety questions
function extractMealNameFromSafetyQuestion(message) {
  const messageLower = message.toLowerCase();
  
  const extractionPatterns = [
    /can i (eat|have|consume|try) ([\w\s\-]+)(\?)?/i,
    /is ([\w\s\-]+) safe for me(\?)?/i,
    /should i avoid ([\w\s\-]+)(\?)?/i,
    /am i allergic to ([\w\s\-]+)(\?)?/i,
    /will ([\w\s\-]+) cause (an|a) (allergic reaction|allergy)(\?)?/i,
    /is it safe for me to eat ([\w\s\-]+)(\?)?/i,
    /is ([\w\s\-]+) ok with my allergies(\?)?/i
  ];
  
  for (const pattern of extractionPatterns) {
    const match = messageLower.match(pattern);
    if (match) {
      // Different patterns have the meal name in different capture groups
      if (pattern.toString().includes("can i (eat|have|consume|try)")) {
        return match[2].trim();
      } else if (pattern.toString().includes("is (")) {
        return match[1].trim();
      } else if (pattern.toString().includes("should i avoid")) {
        return match[1].trim();
      } else if (pattern.toString().includes("am i allergic to")) {
        return match[1].trim();
      } else if (pattern.toString().includes("will (")) {
        return match[1].trim();
      } else if (pattern.toString().includes("safe for me to eat")) {
        return match[1].trim();
      }
    }
  }
  
  return null;
}

// Function to check if a meal contains user's allergens
async function checkMealForAllergens(mealName, userAllergies) {
  if (!userAllergies || userAllergies.length === 0) {
    return { safe: true, allergens: [] };
  }
  
  try {
    // First check if the meal name itself contains an allergen
    const directAllergens = [];
    const mealNameLower = mealName.toLowerCase();
    
    for (const allergen of userAllergies) {
      const allergenLower = allergen.toLowerCase();
      if (mealNameLower.includes(allergenLower)) {
        directAllergens.push(allergen);
      }
    }
    
    if (directAllergens.length > 0) {
      return {
        safe: false,
        allergens: directAllergens,
        message: `This meal name "${mealName}" directly contains your allergen(s): ${directAllergens.join(', ')}.`
      };
    }
    
    // Then check MealDB for ingredients
    console.log(`Checking MealDB for ingredients in ${mealName}...`);
    
    try {
      const response = await axios.get(`https://www.themealdb.com/api/json/v1/1/search.php?s=${encodeURIComponent(mealName)}`);
      
      if (response.data && response.data.meals && response.data.meals.length > 0) {
        const meal = response.data.meals[0];
        const foundAllergens = [];
        const ingredients = [];
        
        // Extract ingredients
        for (let i = 1; i <= 20; i++) {
          const ingredient = meal[`strIngredient${i}`];
          if (ingredient && ingredient.trim()) {
            ingredients.push(ingredient.toLowerCase());
          }
        }
        
        console.log(`Found ingredients in ${mealName}: ${ingredients.join(', ')}`);
        
        // Check each ingredient against allergies
        for (const ingredient of ingredients) {
          for (const allergen of userAllergies) {
            const allergenLower = allergen.toLowerCase();
            if (ingredient.includes(allergenLower) || allergenLower.includes(ingredient)) {
              foundAllergens.push({ allergen, ingredient });
            }
          }
        }
        
        if (foundAllergens.length > 0) {
          const uniqueAllergens = [...new Set(foundAllergens.map(a => a.allergen))];
          return {
            safe: false,
            allergens: uniqueAllergens,
            ingredients: foundAllergens.map(a => a.ingredient),
            message: `The meal "${mealName}" contains ingredients (${foundAllergens.map(a => a.ingredient).join(', ')}) that contain allergens you're allergic to: ${uniqueAllergens.join(', ')}.`
          };
        }
        
        return {
          safe: true,
          allergens: [],
          message: `Based on our ingredient check, "${mealName}" appears safe for you to eat.`
        };
      }
    } catch (error) {
      console.error(`Error checking MealDB for ${mealName}:`, error);
    }
    
    // If we couldn't check detailed ingredients or no match found
    return {
      safe: null,
      allergens: [],
      message: `I couldn't verify all ingredients in "${mealName}". Since you have allergies to ${userAllergies.join(', ')}, please check ingredients carefully before eating.`
    };
  } catch (error) {
    console.error('Error in allergy check:', error);
    // Safety first - if we can't check, assume it might be unsafe
    return {
      safe: false,
      allergens: userAllergies,
      message: `Due to a technical error, I couldn't verify if "${mealName}" is safe with your allergies to ${userAllergies.join(', ')}. For safety, please assume it may contain allergens.`
    };
  }
}

// Helper function to calculate age from DD/MM/YYYY format
function calculateAge(dateString) {
  try {
    if (!dateString) return null;
    
    const parts = dateString.split('/');
    if (parts.length !== 3) return null;
    
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const year = parseInt(parts[2]);
    
    const birthDate = new Date(year, month - 1, day);
    const today = new Date();
    
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return age;
  } catch (e) {
    console.error('Error calculating age:', e);
    return null;
  }
}

// Function to detect meal suggestion queries for specific meal times
function isMealSuggestionQuery(message) {
  const messageLower = message.toLowerCase();
  
  const mealSuggestionPatterns = [
    /what (should|can|could) i (eat|have) for (breakfast|lunch|dinner|snack)/i,
    /suggest (a|some) (breakfast|lunch|dinner|snack)/i,
    /recommend (a|some) (meal|food) for (breakfast|lunch|dinner|snack)/i,
    /(breakfast|lunch|dinner|snack) (suggestion|recommendation|idea)/i,
    /what('s| is) (a good|healthy) (breakfast|lunch|dinner|snack)/i,
    /what (breakfast|lunch|dinner|snack) (should|can|could) i (eat|have)/i
  ];
  
  return mealSuggestionPatterns.some(pattern => pattern.test(messageLower));
}

// Function to extract meal time from the query
function extractMealTime(message) {
  const messageLower = message.toLowerCase();
  const mealTimes = ['breakfast', 'lunch', 'dinner', 'snack'];
  
  for (const mealTime of mealTimes) {
    if (messageLower.includes(mealTime)) {
      return mealTime;
    }
  }
  
  return null;
}

// Function to get nutritional requirements for a specific meal time
function getMealNutritionRequirements(nutritionData, mealTime) {
  // Default distribution if not specified in user data
  const defaultDistribution = {
    breakfast: { calories: 0.25, protein: 0.25, carbs: 0.3, fat: 0.25 },
    lunch: { calories: 0.35, protein: 0.35, carbs: 0.35, fat: 0.35 },
    dinner: { calories: 0.35, protein: 0.35, carbs: 0.3, fat: 0.35 },
    snack: { calories: 0.05, protein: 0.05, carbs: 0.05, fat: 0.05 }
  };
  
  // Get the distribution for the requested meal time
  const distribution = nutritionData.mealDistribution?.[mealTime] || 
                       defaultDistribution[mealTime];
  
  // Calculate target nutrition values
  return {
    calories: Math.round(nutritionData.dailyCalories * distribution.calories),
    protein: Math.round(nutritionData.dailyProtein * distribution.protein),
    carbs: Math.round(nutritionData.dailyCarbs * distribution.carbs),
    fat: Math.round(nutritionData.dailyFat * distribution.fat)
  };
}

// Function to find meals matching nutritional requirements
function findMatchingMeals(allMeals, requirements, tolerance = 0.15) {
  const matchingMeals = [];
  
  // Calculate tolerance ranges
  const ranges = {
    calories: {
      min: requirements.calories * (1 - tolerance),
      max: requirements.calories * (1 + tolerance)
    },
    protein: {
      min: requirements.protein * (1 - tolerance),
      max: requirements.protein * (1 + tolerance)
    },
    carbs: {
      min: requirements.carbs * (1 - tolerance),
      max: requirements.carbs * (1 + tolerance)
    },
    fat: {
      min: requirements.fat * (1 - tolerance),
      max: requirements.fat * (1 + tolerance)
    }
  };
  
  // Check each meal against requirements
  for (const meal of allMeals) {
    // Skip meals without nutrition data
    if (!meal.nutrition) continue;
    
    // Check if meal is within tolerance for all nutrients
    const caloriesMatch = meal.nutrition.calories >= ranges.calories.min && 
                          meal.nutrition.calories <= ranges.calories.max;
    
    const proteinMatch = meal.nutrition.protein >= ranges.protein.min && 
                         meal.nutrition.protein <= ranges.protein.max;
    
    const carbsMatch = meal.nutrition.carbs >= ranges.carbs.min && 
                       meal.nutrition.carbs <= ranges.carbs.max;
    
    const fatMatch = meal.nutrition.fat >= ranges.fat.min && 
                     meal.nutrition.fat <= ranges.fat.max;
    
    // Add to matching meals if all criteria are met
    if (caloriesMatch && proteinMatch && carbsMatch && fatMatch) {
      matchingMeals.push(meal);
    }
  }
  
  return matchingMeals;
}

// API route for fitness recommendations
app.post('/api/fitness-recommendations', async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Fetch user data from Firebase
    const userData = await firebase.getUserData(userId);
    
    if (!userData) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Load nutrition data
    const nutritionData = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'data', 'meals_nutrition.json'), 'utf8')
    );
    
    // Get workout recommendations based on user's fitness level
    const workoutDays = userData.workoutDaysPerWeek || 3;
    const workoutPlan = await wger.getFullBodyWorkoutPlan(workoutDays);
    
    // Build a comprehensive prompt using the template
    const prompt = promptTemplates.buildWorkoutMealPrompt(userData, nutritionData, workoutPlan);
    
    // Call Ollama with the prompt
    const recommendations = await ollama.generateResponse(prompt);
    
    // Return the result
    res.json(recommendations);
    
  } catch (error) {
    console.error('Error generating recommendations:', error);
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// Simple test endpoint for basic chat
app.post('/api/simple-chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    console.log(`Received chat message: "${message}"`);
    
    // Very simple prompt for Ollama
    const prompt = `User: ${message}\n\nResponse:`;
    
    console.log("Sending simple prompt to Ollama");
    
    // Call Ollama with minimal processing
    const response = await ollama.generateResponse(prompt);
    
    console.log("Received response from Ollama");
    
    // Return the response
    res.json({ response: response });
    
  } catch (error) {
    console.error('Error in simple chat endpoint:', error);
    res.status(500).json({ error: 'Chat failed', details: error.message });
  }
});

// MAIN CHAT ENDPOINT - ONE IMPLEMENTATION THAT HANDLES ALL CASES
app.post('/api/chat', async (req, res) => {
  try {
    const { message, userId } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    
    console.log(`Received chat message from user ${userId || 'unknown'}: "${message}"`);
    
    // Fetch user data if userId is provided
    let userData = null;
    let userAllergies = [];
    let foodLikes = [];
    let foodDislikes = [];
    
    if (userId) {
      userData = await firebase.getUserData(userId);
      
      // Extract food preferences and allergies
      if (userData && userData.bodyData) {
        userAllergies = userData.bodyData.allergies || [];
        foodLikes = userData.bodyData.foodLikes || [];
        foodDislikes = userData.bodyData.foodDislikes || [];
        console.log(`User has ${userAllergies.length} allergies: ${userAllergies.join(', ')}`);
      }
    }
    
    // PRIORITY 0: Handle greeting messages
    if (isGreeting(message)) {
      console.log(`Detected greeting message: "${message}"`);
      
      // Personalize greeting based on user data and time of day
      const username = userData?.firstName || 'there';
      const currentHour = new Date().getHours();
      let timeGreeting = 'Hello';
      
      if (currentHour < 12) {
        timeGreeting = 'Good morning';
      } else if (currentHour < 18) {
        timeGreeting = 'Good afternoon';
      } else {
        timeGreeting = 'Good evening';
      }
      
      const prompt = `
        You are Coach X, an enthusiastic and helpful fitness and nutrition coach.
        
        The user has just greeted you with "${message}".
        
        ${userData ? `## USER INFO\nName: ${username}\nGoal: ${userData.bodyData?.goal || 'Not set yet'}\nFitness Level: ${userData.workoutData?.fitnessLevel || 'Not set yet'}` : ''}
        
        ## INSTRUCTIONS
        - Start with "${timeGreeting}, ${username}!"
        - Welcome them warmly to Coach X's fitness assistant
        - Provide a brief guide to what you can help with:
          * Nutritional information about foods
          * Personalized meal suggestions for each meal time
          * Workout plans and exercise technique guidance
          * Checking if foods are safe with their allergies
        - If they have set goals (${userData?.bodyData?.goal || 'none set'}), mention you're here to help with them
        - Invite them to ask a specific question to get started
        - Keep your response friendly, enthusiastic and concise
        
        ## YOUR RESPONSE
      `;
      
      const response = await ollama.generateResponse(prompt);
      return res.json({ response });
    }
    
    // PRIORITY 1: Check for allergy safety questions first
    if (isMealSafetyQuestion(message) && userAllergies.length > 0) {
      const mealName = extractMealNameFromSafetyQuestion(message);
      
      if (mealName) {
        console.log(`Checking if ${mealName} is safe for user with allergies: ${userAllergies.join(', ')}`);
        
        // PRIORITY CHECK: Check if the meal name directly contains an allergen
        let directAllergenMatch = null;
        const lowerMealName = mealName.toLowerCase();
        
        for (const allergen of userAllergies) {
          const allergenLower = allergen.toLowerCase();
          if (lowerMealName.includes(allergenLower)) {
            directAllergenMatch = allergen;
            break;
          }
        }
        
        if (directAllergenMatch) {
          // UNSAFE: The meal name directly contains an allergen
          console.log(`⚠️ UNSAFE: ${mealName} contains allergen ${directAllergenMatch}`);
          
          const prompt = `
            You are Coach X, a cautious nutrition coach who prioritizes user health and safety.
            
            The user ${userData?.firstName || ''} has a food allergy to ${directAllergenMatch}.
            
            They just asked: "${message}"
            
            The meal "${mealName}" contains ${directAllergenMatch}, which they are allergic to.
            
            ## IMPORTANT INSTRUCTIONS
            - START your response with "NO, you should not eat ${mealName}."
            - Clearly explain that it contains ${directAllergenMatch} which they're allergic to
            - Be firm but friendly in your warning
            - Suggest an alternative if possible
          `;
          
          const response = await ollama.generateResponse(prompt);
          return res.json({ response });
        }
        
        // If no direct match in name, check detailed ingredients
        const allergenCheck = await checkMealForAllergens(mealName, userAllergies);
        
        if (allergenCheck.safe === false) {
          // UNSAFE: The meal contains allergens based on ingredients
          console.log(`⚠️ UNSAFE: ${mealName} contains allergens: ${allergenCheck.allergens.join(', ')}`);
          
          const prompt = `
            You are Coach X, a cautious nutrition coach who prioritizes user health and safety.
            
            The user ${userData?.firstName || ''} has food allergies to: ${userAllergies.join(', ')}.
            
            They just asked: "${message}"
            
            ${allergenCheck.message}
            
            ## IMPORTANT INSTRUCTIONS
            - START your response with "NO, you should not eat ${mealName}."
            - Clearly explain why it's unsafe (${allergenCheck.allergens.join(', ')})
            - Be firm but friendly in your warning
            - Suggest an alternative if possible
          `;
          
          const response = await ollama.generateResponse(prompt);
          return res.json({ response });
        }
      }
    }
    
    // PRIORITY 1.5: Handle meal suggestion queries
    if (isMealSuggestionQuery(message) && userId) {
      const mealTime = extractMealTime(message);
      
      if (mealTime) {
        console.log(`User asked for ${mealTime} suggestions`);
        
        try {
          // Fetch user's nutrition data from Firebase
          const nutritionDataRef = firebase.admin.database().ref(`users/${userId}/nutritionData`);
          const nutritionSnapshot = await nutritionDataRef.once('value');
          
          if (nutritionSnapshot.exists()) {
            const nutritionData = nutritionSnapshot.val();
            
            // Calculate nutrition requirements for this meal
            const mealRequirements = getMealNutritionRequirements(nutritionData, mealTime);
            
            console.log(`Nutrition requirements for ${mealTime}:`, mealRequirements);
            
            // Load all meals with nutrition data
            const allMeals = JSON.parse(
              fs.readFileSync(path.join(__dirname, 'data', 'meals_nutrition.json'), 'utf8')
            );
            
            // Find meals matching the requirements
            const matchingMeals = findMatchingMeals(allMeals, mealRequirements);
            
            // Get user's allergies and preferences
            const userAllergies = userData?.bodyData?.allergies || [];
            const userLikes = userData?.bodyData?.foodLikes || [];
            const userDislikes = userData?.bodyData?.foodDislikes || [];
            
            // Filter out meals containing allergens or disliked foods
            const safeMatchingMeals = [];
            
            for (const meal of matchingMeals) {
              // Skip meals the user dislikes
              const mealName = meal.meal.strMeal.toLowerCase();
              const isDisliked = userDislikes.some(food => 
                mealName.includes(food.toLowerCase()) || 
                food.toLowerCase().includes(mealName)
              );
              
              if (isDisliked) continue;
              
              // Check for allergens
              if (userAllergies.length > 0) {
                const allergenCheck = await checkMealForAllergens(meal.meal.strMeal, userAllergies);
                if (allergenCheck.safe === false) continue;
              }
              
              // Mark if it's a preferred food
              const isLiked = userLikes.some(food => 
                mealName.includes(food.toLowerCase()) || 
                food.toLowerCase().includes(mealName)
              );
              
              safeMatchingMeals.push({
                ...meal,
                isLiked
              });
            }
            
            // Sort preferred meals first
            safeMatchingMeals.sort((a, b) => {
              if (a.isLiked && !b.isLiked) return -1;
              if (!a.isLiked && b.isLiked) return 1;
              return 0;
            });
            
            // Get top 5 matches
            const topMeals = safeMatchingMeals.slice(0, 5);
            
            if (topMeals.length > 0) {
              // Build prompt with meal suggestions
              let mealSuggestions = `## MEAL SUGGESTIONS FOR ${mealTime.toUpperCase()}\n`;
              topMeals.forEach((meal, index) => {
                mealSuggestions += `${index + 1}. ${meal.meal.strMeal} (${meal.nutrition.calories} calories, ` +
                  `${meal.nutrition.protein}g protein, ${meal.nutrition.carbs}g carbs, ` +
                  `${meal.nutrition.fat}g fat)${meal.isLiked ? ' - One of your favorites!' : ''}\n`;
              });
              
              const prompt = `
                You are Coach X, a personalized nutrition coach.
                
                ${userData ? `## USER INFO\n${userData.firstName || 'User'}, ${userData.bodyData?.gender || ''}, ${userData.bodyData?.age || ''} years old` : ''}
                
                ## NUTRITION REQUIREMENTS FOR ${mealTime.toUpperCase()}
                The user needs approximately:
                - ${mealRequirements.calories} calories
                - ${mealRequirements.protein}g protein
                - ${mealRequirements.carbs}g carbs
                - ${mealRequirements.fat}g fat
                
                ${mealSuggestions}
                
                ## USER QUERY
                ${message}
                
                ## INSTRUCTIONS
                - Recommend 2-3 of these meal options for the user's ${mealTime}
                - Explain briefly why they match their nutritional needs
                - If you see any favorites marked, emphasize those
                - Keep your response friendly and concise
                
                ## YOUR RESPONSE
              `;
              
              const response = await ollama.generateResponse(prompt);
              return res.json({ response });
            } else {
              // No matching meals found - suggest alternatives
              const prompt = `
                You are Coach X, a personalized nutrition coach.
                
                ${userData ? `## USER INFO\n${userData.firstName || 'User'}, ${userData.bodyData?.gender || ''}, ${userData.bodyData?.age || ''} years old` : ''}
                
                ## NUTRITION REQUIREMENTS FOR ${mealTime.toUpperCase()}
                The user needs approximately:
                - ${mealRequirements.calories} calories
                - ${mealRequirements.protein}g protein
                - ${mealRequirements.carbs}g carbs
                - ${mealRequirements.fat}g fat
                
                I couldn't find specific meals in our database that match these requirements exactly.
                
                ## USER QUERY
                ${message}
                
                ## INSTRUCTIONS
                - Explain that you don't have specific meal matches in the database
                - Suggest 2-3 general meal ideas that would fit these nutritional requirements
                - Keep your response friendly and helpful
                
                ## YOUR RESPONSE
              `;
              
              const response = await ollama.generateResponse(prompt);
              return res.json({ response });
            }
          } else {
            // No nutrition data found
            const prompt = `
              You are Coach X, a personalized nutrition coach.
              
              ${userData ? `## USER INFO\n${userData.firstName || 'User'}, ${userData.bodyData?.gender || ''}, ${userData.bodyData?.age || ''} years old` : ''}
              
              I don't have your personalized nutrition data yet.
              
              ## USER QUERY
              ${message}
              
              ## INSTRUCTIONS
              - Explain that you need to calculate their nutritional needs first
              - Encourage them to complete their profile with height, weight, activity level, and goals
              - Offer some general healthy ${mealTime} suggestions based on their profile
              
              ## YOUR RESPONSE
            `;
            
            const response = await ollama.generateResponse(prompt);
            return res.json({ response });
          }
        } catch (error) {
          console.error('Error handling meal suggestion:', error);
          // Continue to general chat if there's an error
        }
      }
    }
    
    // PRIORITY 2: Handle nutrition queries
    if (isNutritionQuery(message)) {
      const mealName = extractMealName(message);
      
      if (mealName) {
        // Load nutrition data
        const nutritionData = JSON.parse(
          fs.readFileSync(path.join(__dirname, 'data', 'meals_nutrition.json'), 'utf8')
        );
        
        // Find matching meals
        const matchingMeals = nutritionData.filter(item => 
          item.meal.strMeal.toLowerCase().includes(mealName.toLowerCase())
        );
        
        if (matchingMeals.length > 0) {
          // Check for allergies in the meal
          const allergyWarnings = userAllergies.length > 0 ? 
            await checkMealForAllergens(matchingMeals[0].meal.strMeal, userAllergies) : [];
          
          // Check if this is a liked or disliked food
          const isLiked = foodLikes.some(food => 
            food.toLowerCase().includes(mealName.toLowerCase()) ||
            mealName.toLowerCase().includes(food.toLowerCase())
          );
          
          const isDisliked = foodDislikes.some(food => 
            food.toLowerCase().includes(mealName.toLowerCase()) ||
            mealName.toLowerCase().includes(food.toLowerCase())
          );
          
          // Build nutrition-focused prompt
          let nutritionInfo = "## NUTRITION DATA\n";
          matchingMeals.forEach(meal => {
            nutritionInfo += `${meal.meal.strMeal}: ${meal.nutrition.calories} calories, ` +
              `${meal.nutrition.protein}g protein, ${meal.nutrition.carbs}g carbs, ` +
              `${meal.nutrition.fat}g fat\n`;
          });
          
          let prompt = `
            You are Coach X, a personal nutrition coach.
            
            ${userData ? `## USER INFO\n${userData.firstName || 'User'}, ${userData.bodyData?.gender || ''}, ${userData.bodyData?.age || ''} years old` : ''}
            
            ${nutritionInfo}
            
            ${allergyWarnings.length > 0 ? 
              `## ALLERGY WARNING\nThis meal contains ingredients the user is allergic to: ${allergyWarnings.join(', ')}.\nBegin your response with this allergy warning.` : ''}
              
            ${isLiked ? `## USER PREFERENCE\nThe user has marked this food as one they like.` : ''}
            ${isDisliked ? `## USER PREFERENCE\nThe user has marked this food as one they dislike.` : ''}
            
            ## INSTRUCTIONS
            - Provide the EXACT nutrition values shown above
            ${allergyWarnings.length > 0 ? '- Start with a clear allergy warning' : ''}
            ${isLiked ? '- Mention that this is one of their favorite foods' : ''}
            ${isDisliked ? '- Note that they usually avoid this food, but provide nutrition data anyway' : ''}
            - Keep your response concise and focused on the nutrition information
            
            ## USER QUERY
            ${message}
            
            ## YOUR RESPONSE
          `;
          
          const response = await ollama.generateResponse(prompt);
          return res.json({ response });
        }
      }
    }
    
    // PRIORITY 3: Handle specific exercise questions
    if (isSpecificExerciseQuery(message)) {
      console.log('Detected specific exercise query');
      
      // Extract exercise name
      const exerciseName = extractExerciseName(message);
      console.log(`Looking up exercise: ${exerciseName}`);
      
      if (exerciseName) {
        // Get exercise information
        const exerciseInfo = await getExerciseInfo(exerciseName);
        
        if (exerciseInfo.found) {
          const exercise = exerciseInfo.exercise;
          
          const prompt = `
            You are Coach X, a certified personal trainer and exercise specialist.
            
            ## EXERCISE INFORMATION
            Name: ${exercise.name}
            Description: ${exercise.description}
            Primary Muscles: ${exercise.muscles.join(', ')}
            Secondary Muscles: ${exercise.musclesSecondary.join(', ') || 'None'}
            Equipment: ${exercise.equipment.join(', ') || 'Bodyweight'}
            
            ## USER QUERY
            ${message}
            
            ## INSTRUCTIONS
            - Provide detailed information about the ${exercise.name} exercise
            - Explain proper form and technique in a step-by-step manner
            - Describe common mistakes and how to avoid them
            - Mention the primary muscles worked and benefits
            - Provide any relevant safety tips
            - Keep your response conversational and helpful
            
            ## YOUR RESPONSE
          `;
          
          const response = await ollama.generateResponse(prompt);
          return res.json({ response });
        } else {
          // Exercise not found in database
          const prompt = `
            You are Coach X, a certified personal trainer and exercise specialist.
            
            I don't have specific information about "${exerciseName}" in my exercise database.
            
            ## USER QUERY
            ${message}
            
            ## INSTRUCTIONS
            - Explain that you don't have detailed information about this specific exercise
            - Provide general guidance about this type of exercise if you can recognize it
            - Emphasize the importance of proper form and technique
            - Suggest seeking guidance from a certified trainer for exercises you're unfamiliar with
            - If this seems like a common exercise with a different name, suggest what it might be
            
            ## YOUR RESPONSE
          `;
          
          const response = await ollama.generateResponse(prompt);
          return res.json({ response });
        }
      }
    }
    
    // PRIORITY 4: Handle general queries with user context
    // Build appropriate context from user data
    const userContext = userData ? {
      personalData: {
        name: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || 'User',
        email: userData.email || '',
        username: userData.username || '',
      },
      bodyData: userData.bodyData ? {
        gender: userData.bodyData.gender || '',
        age: calculateAge(userData.bodyData.dateOfBirth) || '',
        weight: userData.bodyData.weight || '',
        height: userData.bodyData.height || '',
        activityLevel: userData.bodyData.activityLevel || '',
        goal: userData.bodyData.goal || '',
        allergies: userData.bodyData.allergies || [],
        foodLikes: userData.bodyData.foodLikes || [],
        foodDislikes: userData.bodyData.foodDislikes || [],
      } : {},
      workoutData: userData.workoutData || {}
    } : {};
    
    // Build prompt with context
    const prompt = `
      You are Coach X, a personal fitness and nutrition coach.
      
      ${userData ? `## USER PROFILE\n${JSON.stringify(userContext, null, 2)}` : ''}
      
      ## INSTRUCTIONS
      - Provide personalized advice based on the user's profile
      - Keep responses concise and helpful
      - If the user asks about foods they're allergic to, warn them
      - Recommend foods they like and avoid suggesting foods they dislike
      
      ## USER QUERY
      ${message}
      
      ## YOUR RESPONSE
    `;
    
    const response = await ollama.generateResponse(prompt);
    console.log("Sending response back to app");
    return res.json({ response });
    
  } catch (error) {
    console.error('Error handling chat:', error);
    res.status(500).json({ 
      error: 'Chat response failed', 
      message: error.message 
    });
  }
});

// Test endpoint for Firebase connection
app.get('/api/test-firebase', async (req, res) => {
  try {
    console.log('Testing Firebase connection...');
    
    // Attempt to get a reference to the database
    const dbRef = firebase.admin.database().ref('users');
    
    // Try to list the first few users
    const snapshot = await dbRef.limitToFirst(2).once('value');
    
    if (snapshot.exists()) {
      // Get user IDs for verification
      const users = [];
      snapshot.forEach(childSnapshot => {
        users.push({
          userId: childSnapshot.key,
          hasData: true
        });
      });
      
      console.log('✅ Firebase connection successful');
      console.log(`Found ${users.length} users in database`);
      
      // Return success with limited user info (for security)
      return res.json({
        success: true, 
        message: 'Firebase connection successful',
        userCount: users.length,
        sampleUsers: users
      });
    } else {
      console.log('✅ Firebase connected but no users found');
      return res.json({
        success: true,
        message: 'Firebase connected but no users found',
        userCount: 0
      });
    }
  } catch (error) {
    console.error('❌ Firebase test failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Firebase connection failed',
      error: error.message
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Fitness backend server running on port ${PORT}`);
});

// Function to detect workout-related questions
function isWorkoutQuery(message) {
  const messageLower = message.toLowerCase();
  
  const workoutPatterns = [
    /workout for ([\w\s]+)/i,
    /exercises? for ([\w\s]+)/i,
    /how (to|do i|can i|should i) (train|work|exercise) (my )?([\w\s]+)/i,
    /what (exercises?|workout|training) (for|to) ([\w\s]+)/i,
    /(recommend|suggest) (a|some) (exercises?|workout) for ([\w\s]+)/i,
    /help me (train|build|tone|strengthen) (my )?([\w\s]+)/i,
    /best (exercises?|workout|training) for ([\w\s]+)/i,
    /how (to|do i|can i) (gain muscle|lose weight|get stronger|build strength)/i,
    /what (should|can) i do (at|in) (the )?(gym|home|outdoors)/i,
    /workout plan/i,
    /training (plan|program|routine|schedule)/i,
    /fitness (plan|program|routine|schedule)/i,
    /my (workout|exercise|training) (plan|routine)/i
  ];
  
  return workoutPatterns.some(pattern => pattern.test(messageLower));
}

// Function to extract target muscle group from query
function extractMuscleGroup(message) {
  const messageLower = message.toLowerCase();
  
  // List of muscle groups to check for
  const muscleGroups = [
    "full body", "upper body", "lower body", "core", "arms", 
    "chest", "back", "shoulders", "legs", "glutes", "abs",
    "biceps", "triceps", "forearms", "quads", "hamstrings", "calves"
  ];
  
  // Regex patterns for extracting muscle groups
  const patterns = [
    /workout for ([\w\s]+)/i,
    /exercises? for ([\w\s]+)/i,
    /how (to|do i|can i|should i) (train|work|exercise) (my )?([\w\s]+)/i,
    /what (exercises?|workout|training) (for|to) ([\w\s]+)/i,
    /(recommend|suggest) (a|some) (exercises?|workout) for ([\w\s]+)/i,
    /help me (train|build|tone|strengthen) (my )?([\w\s]+)/i,
    /best (exercises?|workout|training) for ([\w\s]+)/i
  ];
  
  // Try to extract with patterns
  for (const pattern of patterns) {
    const match = messageLower.match(pattern);
    if (match) {
      const potentialMuscle = match[match.length - 1].trim();
      // Return if it matches a known muscle group
      if (muscleGroups.some(muscle => potentialMuscle.includes(muscle))) {
        return potentialMuscle;
      }
    }
  }
  
  // If no extraction pattern worked, check for direct mentions
  for (const muscleGroup of muscleGroups) {
    if (messageLower.includes(muscleGroup)) {
      return muscleGroup;
    }
  }
  
  // Default to full body if no specific muscle group found
  return null;
}

// Function to get workout recommendations
async function getWorkoutRecommendations(userId, muscleGroup = null) {
  try {
    // Get user data
    const userData = await firebase.getUserData(userId);
    if (!userData || !userData.workoutData) {
      return { 
        hasData: false,
        userData: userData || null
      };
    }
    
    const workoutData = userData.workoutData;
    
    // Get appropriate exercises from WGER API based on user preferences
    let exercises = [];
    
    // Determine level for WGER API
    let difficultyLevel = 1; // Default to beginner
    if (workoutData.fitnessLevel === "Intermediate") difficultyLevel = 2;
    if (workoutData.fitnessLevel === "Advanced") difficultyLevel = 3;
    
    // Target specific muscle group if provided, otherwise use user preferences
    let targetMuscleGroups = [];
    if (muscleGroup) {
      // Map the extracted muscle group to WGER categories
      const muscleMapping = {
        "full body": [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        "upper body": [1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13],
        "lower body": [7, 8, 10, 14, 15],
        "core": [6, 14],
        "arms": [1, 5, 13],
        "chest": [4, 9],
        "back": [3, 12],
        "shoulders": [2, 9],
        "legs": [7, 8, 10, 15],
        "glutes": [8],
        "abs": [6],
        "biceps": [1],
        "triceps": [5],
        "forearms": [13],
        "quads": [10],
        "hamstrings": [11],
        "calves": [7]
      };
      
      targetMuscleGroups = muscleMapping[muscleGroup] || [];
    } else if (workoutData.muscleGroups && workoutData.muscleGroups.length > 0) {
      // Map user's selected muscle groups to WGER categories
      const muscleMappingFromUser = {
        "Full body": [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        "Upper body": [1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13],
        "Lower body": [7, 8, 10, 14, 15],
        "Core": [6, 14],
        "Arms": [1, 5, 13],
        "Chest": [4, 9],
        "Back": [3, 12],
        "Shoulders": [2, 9],
        "Legs": [7, 8, 10, 15],
        "Glutes": [8]
      };
      
      // Combine all selected muscle groups
      workoutData.muscleGroups.forEach(group => {
        const muscleIds = muscleMappingFromUser[group] || [];
        targetMuscleGroups = [...targetMuscleGroups, ...muscleIds];
      });
      
      // Remove duplicates
      targetMuscleGroups = [...new Set(targetMuscleGroups)];
    }
    
    // Default to full body if no muscle groups specified
    if (targetMuscleGroups.length === 0) {
      targetMuscleGroups = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    }
    
    // Filter equipment based on user preferences
    let availableEquipment = [];
    if (workoutData.equipment && workoutData.equipment.length > 0) {
      // Map from user-friendly names to WGER equipment IDs
      const equipmentMapping = {
        "Bodyweight only": [7],
        "Dumbbells": [3],
        "Barbell": [1],
        "Machines": [4, 5, 6, 10],
        "Resistance bands": [9],
        "Kettlebells": [10],
        "TRX/Suspension": [6],
        "Medicine ball": [2],
        "Stability ball": [8]
      };
      
      workoutData.equipment.forEach(equip => {
        const equipIds = equipmentMapping[equip] || [];
        availableEquipment = [...availableEquipment, ...equipIds];
      });
      
      availableEquipment = [...new Set(availableEquipment)];
    }
    
    // If no equipment is specified, default to bodyweight
    if (availableEquipment.length === 0) {
      availableEquipment = [7]; // Bodyweight
    }
    
    // Use WGER API to get exercises that match user's criteria
    exercises = await wger.getExercises({
      muscles: targetMuscleGroups,
      equipment: availableEquipment,
      difficulty: difficultyLevel
    });
    
    // Calculate appropriate sets, reps, and rest based on fitness goal and level
    let setsRepsRest = {
      sets: 3,
      minReps: 8,
      maxReps: 12,
      rest: 60
    };
    
    if (workoutData.fitnessGoal === "Weight loss") {
      setsRepsRest = {
        sets: 3,
        minReps: 12,
        maxReps: 15,
        rest: 45
      };
    } else if (workoutData.fitnessGoal === "Muscle gain") {
      setsRepsRest = {
        sets: 4,
        minReps: 8,
        maxReps: 12,
        rest: 90
      };
    }
    
    // Adjust based on fitness level
    if (workoutData.fitnessLevel === "Beginner") {
      setsRepsRest.sets = Math.max(2, setsRepsRest.sets - 1);
      setsRepsRest.rest += 15;
    } else if (workoutData.fitnessLevel === "Advanced") {
      setsRepsRest.sets = Math.min(5, setsRepsRest.sets + 1);
      setsRepsRest.rest -= 15;
    }
    
    return {
      hasData: true,
      userData,
      workoutData,
      exercises,
      setsRepsRest,
      muscleGroup: muscleGroup || (workoutData.muscleGroups && workoutData.muscleGroups[0]) || "full body"
    };
  } catch (error) {
    console.error('Error getting workout recommendations:', error);
    return { 
      hasData: false,
      error: error.message
    };
  }
}

// Function to detect specific exercise questions
function isSpecificExerciseQuery(message) {
  const messageLower = message.toLowerCase();
  
  const exercisePatterns = [
    /how (to|do i) do (a |an )?([\w\s\-]+)/i,
    /correct form for ([\w\s\-]+)/i,
    /technique for ([\w\s\-]+)/i,
    /proper way to do ([\w\s\-]+)/i,
    /form check for ([\w\s\-]+)/i,
    /is my ([\w\s\-]+) form correct/i,
    /what muscles does ([\w\s\-]+) work/i,
    /what are the benefits of ([\w\s\-]+)/i,
    /is ([\w\s\-]+) good for ([\w\s\-]+)/i,
    /alternative to ([\w\s\-]+)/i,
    /replace ([\w\s\-]+) with/i
  ];
  
  return exercisePatterns.some(pattern => pattern.test(messageLower));
}

// Function to extract exercise name from query
function extractExerciseName(message) {
  const messageLower = message.toLowerCase();
  
  const patterns = [
    /how (to|do i) do (a |an )?([\w\s\-]+)/i,
    /correct form for ([\w\s\-]+)/i,
    /technique for ([\w\s\-]+)/i,
    /proper way to do ([\w\s\-]+)/i,
    /form check for ([\w\s\-]+)/i,
    /is my ([\w\s\-]+) form correct/i,
    /what muscles does ([\w\s\-]+) work/i,
    /what are the benefits of ([\w\s\-]+)/i,
    /is ([\w\s\-]+) good for ([\w\s\-]+)/i,
    /alternative to ([\w\s\-]+)/i,
    /replace ([\w\s\-]+) with/i
  ];
  
  for (const pattern of patterns) {
    const match = messageLower.match(pattern);
    if (match) {
      const exerciseName = match[match.length - (pattern.toString().includes('good for') ? 2 : 1)].trim();
      return exerciseName;
    }
  }
  
  return null;
}

// Function to get specific exercise information
async function getExerciseInfo(exerciseName) {
  try {
    // Get exercise details from WGER API
    const exercises = await wger.searchExercises(exerciseName);
    
    if (exercises && exercises.length > 0) {
      return {
        found: true,
        exercise: exercises[0]
      };
    }
    
    return {
      found: false
    };
  } catch (error) {
    console.error('Error getting exercise info:', error);
    return {
      found: false,
      error: error.message
    };
  }
}

// Function to detect greeting messages
function isGreeting(message) {
  const messageLower = message.toLowerCase().trim();
  const greetingPatterns = [
    /^hi$/i,
    /^hello$/i,
    /^hey$/i,
    /^hi there$/i,
    /^hello there$/i,
    /^greetings$/i,
    /^good (morning|afternoon|evening)$/i,
    /^what'?s up$/i,
    /^yo$/i,
    /^howdy$/i,
    /^hola$/i,
    /^bonjour$/i,
    /^sup$/i,
    /^start$/i
  ];
  
  return greetingPatterns.some(pattern => pattern.test(messageLower));
}
