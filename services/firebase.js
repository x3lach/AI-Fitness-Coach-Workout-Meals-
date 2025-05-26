const admin = require('firebase-admin');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Initialize Firebase
let serviceAccount;

// Try to get Firebase credentials from environment variables first
if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  // If credentials are stored as base64-encoded JSON string in .env
  const buff = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64');
  serviceAccount = JSON.parse(buff.toString('utf-8'));
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  // If path to service account JSON file is specified
  serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
} else {
  // Fallback to a default location for development
  try {
    serviceAccount = require('../firebase-service-account.json');
  } catch (error) {
    console.error('Firebase service account credentials not found. Please check your configuration.');
    process.exit(1);
  }
}

// Initialize the Firebase app
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://ollama-fitness-default-rtdb.firebaseio.com'
});

// Get a reference to the database
const db = admin.database();

/**
 * Get user fitness profile data from Firebase
 * @param {string} userId - The user ID to retrieve data for
 * @returns {Promise<object|null>} - The user data object or null if not found
 */
async function getUserData(userId) {
  try {
    // Reference to the user data in Firebase
    const userRef = db.ref(`users/${userId}`);
    
    // Get a snapshot of the user data
    const snapshot = await userRef.once('value');
    
    if (!snapshot.exists()) {
      console.log(`User ${userId} not found in database`);
      return null;
    }
    
    return snapshot.val();
  } catch (error) {
    console.error(`Error fetching user data for ${userId}:`, error);
    throw error;
  }
}

module.exports = {
  getUserData
};