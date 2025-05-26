/**
 * Helper functions to build consistent AI prompts for fitness and nutrition plans
 */

/**
 * Builds the user information section of the prompt
 * @param {Object} userData - User profile data from Firebase
 * @returns {string} - Formatted user info section
 */
function buildUserInfoSection(userData) {
  return `
## USER INFO
Age: ${userData.age || 'Not specified'}
Weight: ${userData.weight ? `${userData.weight} kg` : 'Not specified'}
Height: ${userData.height ? `${userData.height} cm` : 'Not specified'}
Gender: ${userData.gender || 'Not specified'}
Fitness Level: ${userData.fitnessLevel || 'Beginner'}
Goals: ${userData.goals || 'General fitness'}
Dietary Preferences: ${userData.dietaryPreferences || 'None specified'}
Restrictions: ${userData.restrictions || 'None specified'}
`;
}

/**
 * Builds the nutrition data section of the prompt
 * @param {Array} nutritionData - Available nutrition data
 * @returns {string} - Formatted nutrition section
 */
function buildNutritionSection(nutritionData) {
  if (!nutritionData || nutritionData.length === 0) {
    return `## NUTRITION DATA\nNo nutrition data available.`;
  }
  
  // Include just a sample of meals to keep prompt size reasonable
  const sampleMeals = nutritionData.slice(0, 5);
  
  return `
## NUTRITION DATA
Database contains ${nutritionData.length} meals with complete nutritional information.
Sample meals:
${sampleMeals.map(item => 
  `- ${item.meal.strMeal}: ${item.nutrition.calories} calories, ${item.nutrition.protein}g protein, ${item.nutrition.carbs}g carbs, ${item.nutrition.fat}g fat`
).join('\n')}
`;
}

/**
 * Builds the main prompt with instructions for the AI
 * @param {Object} userData - User profile data from Firebase
 * @param {Array} nutritionData - Nutrition data
 * @returns {string} - Complete prompt for the AI
 */
function buildWorkoutMealPrompt(userData, nutritionData = []) {
  // Determine plan duration based on user preference or default to 7 days
  const planDuration = userData.planDuration || 7;
  
  return `
# FITNESS AND NUTRITION PLAN GENERATION

You are a professional fitness coach and nutritionist. Create a personalized ${planDuration}-day fitness and nutrition plan for this client.

${buildUserInfoSection(userData)}
${buildNutritionSection(nutritionData)}

## INSTRUCTIONS
Based on the user's profile and available nutrition data, create a comprehensive plan that includes:

1. A personalized workout schedule with specific exercises, sets, reps, and rest periods
2. A meal plan with specific meals for breakfast, lunch, dinner, and snacks
3. Daily caloric and macronutrient targets
4. Tips for adherence and progress tracking

IMPORTANT GUIDELINES:
- Tailor exercises to the user's fitness level (${userData.fitnessLevel || 'Beginner'})
- Select meals that align with their dietary preferences and restrictions
- Calculate appropriate calorie targets based on their stats and goals
- For weight loss: Create a moderate calorie deficit (300-500 calories below maintenance)
- For muscle gain: Create a moderate calorie surplus (300-500 calories above maintenance)
- For general fitness: Match calories to estimated daily expenditure
- Protein: 1.6-2.2g per kg of bodyweight for muscle building, 1.2-1.6g for maintenance

## RESPONSE FORMAT
Structure your response in JSON format with the following sections:
{
  "overview": {
    "calorieTarget": 0000,
    "proteinTarget": 000,
    "carbTarget": 000,
    "fatTarget": 000,
    "planType": "Weight Loss/Muscle Building/Maintenance"
  },
  "workoutPlan": {
    "day1": {
      "focus": "Push/Pull/Legs/Cardio/Rest",
      "exercises": [
        {"name": "Exercise Name", "sets": 0, "reps": 0, "rest": "60s"}
      ]
    },
    "day2": {},
    // ... continue for all days
  },
  "mealPlan": {
    "day1": {
      "breakfast": {"name": "Meal Name", "calories": 000, "protein": 00},
      "lunch": {},
      "dinner": {},
      "snacks": []
    },
    "day2": {},
    // ... continue for all days
  },
  "tips": ["Tip 1", "Tip 2", "Tip 3"]
}

Ensure all recommendations are personalized to the user's specific profile and goals.
`;
}

module.exports = {
  buildWorkoutMealPrompt
};