// src/config/audit.js - Optimized for speed
const path = require('path');

module.exports = {
  models: {
    openai: {
      model: process.env.AI_MODEL || 'gpt-4o-mini', // Keep fast model
      temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.1, // Reduced for faster, more consistent responses
      maxTokens: parseInt(process.env.MAX_TOKENS) || 2000, // Reduced from 3000 for speed
    },
    chunking: {
      tokenLimit: parseInt(process.env.CHUNK_TOKEN_LIMIT) || 3000, // Larger chunks = fewer API calls
      useFastEstimation: process.env.USE_FAST_ESTIMATION !== 'false', // Default to fast estimation
      maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE) || 50, // Max rows per chunk for size-based chunking
    }
  },
  files: {
    csvFilename: process.env.CSV_FILENAME || 'internal_all.csv',
    promptPath: path.join(__dirname, '../../prompts', process.env.PROMPT_FILE || 'seo_analysis_prompt.txt'),
  },
  retries: {
    maxAttempts: parseInt(process.env.MAX_RETRIES) || 2, // Reduced from 3
    delayMs: parseInt(process.env.RETRY_DELAY_MS) || 1000, // Reduced delay
  },
  performance: {
    // Concurrency settings for faster processing
    chunkConcurrency: parseInt(process.env.CHUNK_CONCURRENCY) || 3, // Increased from 2
    pageBatchSize: parseInt(process.env.PAGE_BATCH_SIZE) || 5, // Increased from 3
    batchDelayMs: parseInt(process.env.BATCH_DELAY_MS) || 2000, // Reduced from 3000
    
    // Size limits for faster processing
    maxPagesForFullAnalysis: parseInt(process.env.MAX_PAGES_FULL_ANALYSIS) || 200,
    maxPagesForPageAnalysis: parseInt(process.env.MAX_PAGES_PAGE_ANALYSIS) || 100,
    
    // Skip heavy processing for large sites
    skipPerPageAnalysisThreshold: parseInt(process.env.SKIP_PAGE_ANALYSIS_THRESHOLD) || 500,
    
    // Cache settings
    enableTokenCache: process.env.ENABLE_TOKEN_CACHE !== 'false',
    cacheSize: parseInt(process.env.CACHE_SIZE) || 1000,
  }
};