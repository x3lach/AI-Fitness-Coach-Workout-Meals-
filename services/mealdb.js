const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// MealDB API configuration
const MEALDB_API_URL = 'https://www.themealdb.com/api/json/v1/1';
const MEALDB_API_KEY = process.env.MEALDB_API_KEY || '1'; // Free tier uses '1'

/**
 * Get a single random meal from MealDB API
 * @returns {Promise<Object>} - A meal object with formatted data
 */
async function getRandomMeal() {
  try {
    const response = await axios.get(`${MEALDB_API_URL}/random.php`);
    
    if (response.data && response.data.meals && response.data.meals.length > 0) {
      return formatMealData(response.data.meals[0]);
    }
    
    throw new Error('No meal data returned from API');
  } catch (error) {
    console.error('Error fetching random meal:', error.message);
    throw error;
  }
}

/**
 * Get multiple random meals from MealDB API
 * @param {number} count - Number of random meals to fetch
 * @returns {Promise<Array>} - Array of meal objects with formatted data
 */
async function getRandomMeals(count = 5) {
  try {
    // MealDB doesn't have an endpoint for multiple random meals,
    // so we need to make multiple requests
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(getRandomMeal());
    }
    
    const meals = await Promise.all(promises);
    
    // Filter out any duplicates by ID
    const uniqueMeals = [...new Map(meals.map(meal => [meal.id, meal])).values()];
    
    return uniqueMeals;
  } catch (error) {
    console.error('Error fetching random meals:', error.message);
    throw error;
  }
}

/**
 * Get meals by category (healthy categories preferred)
 * @param {string} category - Meal category (e.g., 'Vegetarian', 'Seafood', 'Chicken')
 * @param {number} count - Number of meals to return
 * @returns {Promise<Array>} - Array of meal objects with formatted data
 */
async function getMealsByCategory(category = 'Vegetarian', count = 5) {
  try {
    const response = await axios.get(`${MEALDB_API_URL}/filter.php?c=${category}`);
    
    if (response.data && response.data.meals && response.data.meals.length > 0) {
      // Get the details for each meal
      const mealPromises = response.data.meals
        .slice(0, count) // Limit to requested count
        .map(meal => getMealById(meal.idMeal));
      
      return await Promise.all(mealPromises);
    }
    
    throw new Error(`No meals found for category: ${category}`);
  } catch (error) {
    console.error(`Error fetching meals for category ${category}:`, error.message);
    throw error;
  }
}

/**
 * Get detailed meal information by ID
 * @param {string} id - MealDB meal ID
 * @returns {Promise<Object>} - Formatted meal object
 */
async function getMealById(id) {
  try {
    const response = await axios.get(`${MEALDB_API_URL}/lookup.php?i=${id}`);
    
    if (response.data && response.data.meals && response.data.meals.length > 0) {
      return formatMealData(response.data.meals[0]);
    }
    
    throw new Error(`No meal found with ID: ${id}`);
  } catch (error) {
    console.error(`Error fetching meal with ID ${id}:`, error.message);
    throw error;
  }
}

/**
 * Get healthy meals across multiple categories
 * @param {number} count - Total number of meals to return
 * @returns {Promise<Array>} - Array of healthy meal objects
 */
async function getHealthyMeals(count = 10) {
  // Categories considered "healthy"
  const healthyCategories = ['Vegetarian', 'Seafood', 'Chicken', 'Vegan'];
  
  try {
    // Get meals from each healthy category
    const mealsPerCategory = Math.ceil(count / healthyCategories.length);
    const categoryPromises = healthyCategories.map(category => 
      getMealsByCategory(category, mealsPerCategory)
        .catch(() => []) // If a category fails, return empty array
    );
    
    const results = await Promise.all(categoryPromises);
    
    // Flatten the array and take only the requested count
    const allMeals = results.flat().slice(0, count);
    
    return allMeals;
  } catch (error) {
    console.error('Error fetching healthy meals:', error.message);
    throw error;
  }
}

/**
 * Format raw meal data from MealDB API into a more usable structure
 * @param {Object} rawMeal - Raw meal data from MealDB API
 * @returns {Object} - Formatted meal object
 */
function formatMealData(rawMeal) {
  // Extract ingredients and measurements
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const ingredient = rawMeal[`strIngredient${i}`];
    const measure = rawMeal[`strMeasure${i}`];
    
    if (ingredient && ingredient.trim()) {
      ingredients.push({
        name: ingredient,
        measure: measure || ''
      });
    }
  }
  
  // Return formatted meal object
  return {
    id: rawMeal.idMeal,
    name: rawMeal.strMeal,
    category: rawMeal.strCategory,
    area: rawMeal.strArea,
    instructions: rawMeal.strInstructions,
    thumbnail: rawMeal.strMealThumb,
    tags: rawMeal.strTags ? rawMeal.strTags.split(',') : [],
    youtube: rawMeal.strYoutube,
    ingredients,
    source: rawMeal.strSource
  };
}

module.exports = {
  getRandomMeal,
  getRandomMeals,
  getMealsByCategory,
  getMealById,
  getHealthyMeals
};