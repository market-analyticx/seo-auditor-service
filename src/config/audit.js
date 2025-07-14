// src/config/audit.js
const path = require('path');

module.exports = {
  models: {
    openai: {
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.3,
      maxTokens: parseInt(process.env.MAX_TOKENS) || 3000, // Reduced from 4096 for faster responses
    },
    chunking: {
      tokenLimit: parseInt(process.env.CHUNK_TOKEN_LIMIT) || 4000, // Increased from 3000 for fewer chunks
    }
  },
  files: {
    csvFilename: process.env.CSV_FILENAME || 'internal_all.csv',
    promptPath: path.join(__dirname, '../../prompts', process.env.PROMPT_FILE || 'seo_analysis_prompt.txt'),
  },
  retries: {
    maxAttempts: parseInt(process.env.MAX_RETRIES) || 3,
    delayMs: parseInt(process.env.RETRY_DELAY_MS) || 1000, // Reduced from 3000ms
  }
};