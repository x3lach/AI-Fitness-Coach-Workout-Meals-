const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Default configuration
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:8b-instruct-q4_K_M';

/**
 * Generate a response from Ollama using the provided prompt
 * @param {string} prompt - The prompt to send to Ollama
 * @param {object|null} context - Additional context to help with response generation (optional)
 * @returns {Promise<object>} - The parsed response from Ollama
 */
const generateResponse = async (prompt, context = null) => {
  try {
    console.log(`Generating response using model: ${OLLAMA_MODEL}`);
    
    // PERFORMANCE: Optimize model parameters
    const requestBody = {
      model: OLLAMA_MODEL,
      prompt: prompt,
      context: context,
      stream: false,
      options: {
        temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7'),
        top_p: 0.8,
        top_k: 40,
        num_predict: parseInt(process.env.OLLAMA_MAX_TOKENS || '256'),
        num_ctx: 2048  // Reduced context window for faster processing
      }
    };

    const response = await axios.post(OLLAMA_API_URL, requestBody);

    let result = response.data.response;
    
    // Try to parse the response as JSON if it appears to be JSON
    if (result.trim().startsWith('{') && result.trim().endsWith('}')) {
      try {
        result = JSON.parse(result);
      } catch (err) {
        console.warn('Response looks like JSON but failed to parse:', err.message);
        // Continue with the raw string response
      }
    }
    
    return result;
  } catch (error) {
    console.error('Error calling Ollama API:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    throw new Error(`Ollama API error: ${error.message}`);
  }
};

module.exports = {
  generateResponse
};