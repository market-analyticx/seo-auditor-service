// src/config/audit.js
const path = require('path');  // Add this import

module.exports = {
  models: {
    openai: {
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.3,
      maxTokens: parseInt(process.env.MAX_TOKENS) || 4096,
    },
    chunking: {
      tokenLimit: parseInt(process.env.CHUNK_TOKEN_LIMIT) || 3000,
    }
  },
  files: {
    csvFilename: process.env.CSV_FILENAME || 'internal_all.csv',
    promptPath: path.join(__dirname, '../../prompts', process.env.PROMPT_FILE || 'seo_analysis_prompt.txt'),
  },
  retries: {
    maxAttempts: parseInt(process.env.MAX_RETRIES) || 3,
    delayMs: parseInt(process.env.RETRY_DELAY_MS) || 3000,
  }
};