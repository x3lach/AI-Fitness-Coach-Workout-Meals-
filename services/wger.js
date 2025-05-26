const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// WGER API configuration
const WGER_API_URL = 'https://wger.de/api/v2';
const WGER_API_KEY = process.env.WGER_API_KEY || 'YOUR-API-KEY';

// Create axios instance with default configuration
const wgerClient = axios.create({
  baseURL: WGER_API_URL,
  headers: {
    'Accept': 'application/json',
    'Authorization': WGER_API_KEY ? `Token ${WGER_API_KEY}` : undefined
  }
});

// Map of muscle names to their IDs in the WGER API
const muscleGroups = {
  'chest': 4,
  'back': 12,
  'shoulders': 2,
  'biceps': 1,
  'triceps': 5,
  'legs': 10, // Actually quadriceps
  'abs': 6,
  'calves': 7,
  'glutes': 8
};

/**
 * Get exercises for a specific muscle group
 * @param {string} muscleGroup - The muscle group name
 * @param {number} count - Number of exercises to return
 * @returns {Promise<Array>} - Array of exercise objects
 */
async function getExercisesByMuscleGroup(muscleGroup, count = 5) {
  try {
    // Convert muscle group name to ID
    const muscleId = muscleGroups[muscleGroup.toLowerCase()];
    
    if (!muscleId) {
      throw new Error(`Invalid muscle group: ${muscleGroup}. Valid options are: ${Object.keys(muscleGroups).join(', ')}`);
    }
    
    // Get exercises that target this muscle
    const response = await wgerClient.get('/exercise/', {
      params: {
        muscles: muscleId,
        language: 2, // English
        limit: count
      }
    });
    
    if (response.data && response.data.results) {
      return response.data.results.map(formatExerciseData);
    }
    
    return [];
  } catch (error) {
    console.error(`Error fetching exercises for ${muscleGroup}:`, error.message);
    // Return empty array instead of throwing to avoid breaking the application
    return [];
  }
}

/**
 * Get a complete workout plan with exercises for multiple muscle groups
 * @param {string|Array} muscleGroup - Single muscle group or array of muscle groups
 * @param {number} count - Number of exercises per muscle group
 * @returns {Promise<Object>} - Workout plan organized by muscle groups
 */
async function getWorkoutPlan(muscleGroups, exercisesPerMuscle = 3) {
  try {
    // If a single muscle group is provided, convert to array
    let groups = Array.isArray(muscleGroups) ? muscleGroups : [muscleGroups];
    
    // Fix the validation - Check if array has values
    if (!groups || groups.length === 0) {
      // Default to a basic set of muscle groups if none provided
      groups = ['chest', 'back', 'legs'];
      console.log('No muscle groups specified, using defaults:', groups);
    }
    
    // Get exercises for each muscle group (with better error handling)
    const workoutPlan = {};
    
    for (const group of groups) {
      try {
        // Fix the muscle group validation
        if (typeof group === 'string' && Object.keys(muscleGroups).includes(group.toLowerCase())) {
          const exercises = await getExercisesByMuscleGroup(group, exercisesPerMuscle);
          workoutPlan[group] = exercises;
        } else {
          console.log(`Skipping invalid muscle group: ${group}`);
        }
      } catch (err) {
        console.log(`Error fetching exercises for ${group}:`, err);
        // Continue with other muscle groups
      }
    }
    
    return workoutPlan;
  } catch (error) {
    console.error('Error creating workout plan:', error.message);
    // Return a minimal default plan rather than empty object
    return {
      'general': [
        {
          name: 'Push-ups',
          description: 'Basic bodyweight exercise for chest and triceps',
          instructions: ['Sets: 3', 'Reps: 10-15', 'Rest: 60 seconds']
        }
      ]
    };
  }
}

/**
 * Get a balanced full-body workout plan
 * @param {number} daysPerWeek - Number of workout days per week
 * @returns {Promise<Object>} - Full workout plan organized by day
 */
async function getFullBodyWorkoutPlan(daysPerWeek = 3) {
  try {
    // Define workout splits based on days per week
    const workoutSplits = {
      3: [
        ['chest', 'triceps', 'shoulders'],
        ['back', 'biceps'],
        ['legs', 'abs']
      ],
      4: [
        ['chest', 'triceps'],
        ['back', 'biceps'],
        ['shoulders', 'abs'],
        ['legs', 'calves']
      ],
      5: [
        ['chest'],
        ['back'],
        ['legs'],
        ['shoulders'],
        ['arms', 'abs']
      ],
      6: [
        ['chest'],
        ['back'],
        ['legs'],
        ['shoulders'],
        ['arms'],
        ['abs', 'calves']
      ]
    };
    
    // Use appropriate split or default to 3 days
    const split = workoutSplits[daysPerWeek] || workoutSplits[3];
    
    // Create workout plan for each day
    const fullPlan = {};
    
    for (let i = 0; i < split.length; i++) {
      const dayNumber = i + 1;
      const muscleGroupsForDay = split[i];
      
      // Get 3 exercises per muscle group for this day
      const dayPlan = await getWorkoutPlan(muscleGroupsForDay, 3);
      
      fullPlan[`day${dayNumber}`] = {
        focus: muscleGroupsForDay.join(', '),
        exercises: Object.values(dayPlan).flat()
      };
    }
    
    return fullPlan;
  } catch (error) {
    console.error('Error creating full body workout plan:', error.message);
    return {};
  }
}

/**
 * Format raw exercise data from WGER API
 * @param {Object} rawExercise - Raw exercise data
 * @returns {Object} - Formatted exercise object
 */
function formatExerciseData(rawExercise) {
  return {
    id: rawExercise.id,
    name: rawExercise.name,
    description: rawExercise.description.replace(/<[^>]*>?/gm, ''), // Remove HTML tags
    muscles: rawExercise.muscles,
    equipment: rawExercise.equipment,
    category: rawExercise.category?.name || 'Unknown',
    instructions: [
      'Sets: 3-4',
      'Reps: 8-12',
      'Rest: 60-90 seconds between sets'
    ],
    variations: []
  };
}

// Get all available exercise categories
async function getExerciseCategories() {
  try {
    const response = await wgerClient.get('/exercisecategory/');
    return response.data.results;
  } catch (error) {
    console.error('Error fetching exercise categories:', error.message);
    return [];
  }
}

module.exports = {
  getExercisesByMuscleGroup,
  getWorkoutPlan,
  getFullBodyWorkoutPlan,
  getExerciseCategories,
  muscleGroups
};
