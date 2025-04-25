// src/services/auditService.js
const dotenv = require('dotenv');
const path = require('path');

// Load env from the root directory explicitly
const envPath = path.resolve(__dirname, '../../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('Error loading .env file:', result.error);
} else {
  console.log('.env file loaded successfully from:', envPath);
}

const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const chunkService = require('./chunkService');
const config = require('../config/audit');
const fileService = require('./fileService');

class AuditService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      workflowLogger.error('OPENAI_API_KEY not found in environment');
      throw new Error('OPENAI_API_KEY is not set in environment variables');
    }
    
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    workflowLogger.info('OpenAI client initialized');
  }

  async analyzeCSVData(csvData, slug) {
    try {
      // Load prompt template
      workflowLogger.debug('Loading prompt template', { 
        path: config.files.promptPath 
      });
      const promptTemplate = await fileService.readFile(config.files.promptPath);
      
      // Chunk the data
      workflowLogger.info('Chunking data', { 
        rowCount: csvData.length,
        tokenLimit: config.models.chunking.tokenLimit
      });
      const chunks = chunkService.chunkRowsByTokenCount(csvData, config.models.chunking.tokenLimit);
      logger.info(`CSV split into ${chunks.length} chunks`);
      workflowLogger.info('Data chunked', { 
        chunkCount: chunks.length,
        slug 
      });
      
      // Analyze each chunk
      const chunkResults = await this._analyzeChunks(chunks, promptTemplate, slug);
      
      // Generate final analysis
      workflowLogger.info('Generating final analysis', { slug });
      const finalAnalysis = await this._generateFinalAnalysis(chunkResults, slug);
      
      return {
        chunkResults,
        finalAnalysis,
        summary: this._extractSummary(finalAnalysis)
      };
    } catch (error) {
      logger.error(`Analysis failed: ${error.message}`);
      workflowLogger.error('Analysis failed', { 
        slug,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async _analyzeChunks(chunks, promptTemplate, slug) {
    const results = [];
    
    for (let i = 0; i < chunks.length; i++) {
      logger.info(`Processing chunk ${i + 1}/${chunks.length}...`);
      workflowLogger.info('Processing chunk', {
        chunkNumber: i + 1,
        totalChunks: chunks.length,
        slug
      });
      
      try {
        const analysis = await this._analyzeChunk(chunks[i], promptTemplate, slug, i + 1, chunks.length);
        results.push(analysis);
        
        // Delay between API calls
        if (i < chunks.length - 1) {
          workflowLogger.debug('Delaying before next chunk', { 
            delay: config.retries.delayMs 
          });
          await this._delay(config.retries.delayMs);
        }
      } catch (error) {
        logger.error(`Failed to analyze chunk ${i + 1}: ${error.message}`);
        workflowLogger.error('Chunk analysis failed', {
          chunkNumber: i + 1,
          slug,
          error: error.message
        });
        throw error;
      }
    }
    
    return results;
  }

  async _analyzeChunk(chunk, promptTemplate, slug, chunkNumber, totalChunks) {
    const messages = [
      { role: 'system', content: promptTemplate },
      {
        role: 'user',
        content: `Here is chunk ${chunkNumber} of ${totalChunks} for website: ${slug}\n\n${JSON.stringify(chunk, null, 2)}`
      }
    ];
    
    workflowLogger.debug('Calling OpenAI API for chunk', { 
      chunkNumber, 
      slug 
    });
    const response = await this._callOpenAIWithRetry(messages);
    workflowLogger.info('Chunk analysis completed', { 
      chunkNumber, 
      slug,
      responseLength: response.length 
    });
    
    return response;
  }

  async _generateFinalAnalysis(chunkResults, slug) {
    const messages = [
      { 
        role: 'system', 
        content: 'You are an expert SEO analyst. Based on all individual page analyses, provide a comprehensive site-wide SEO assessment.' 
      },
      {
        role: 'user',
        content: `Below are individual page analyses for website: ${slug}\n\n${chunkResults.join('\n')}\n\n
        Based on all the page analyses above, provide a comprehensive SEO analysis of the entire website including:
        
        1. Overall Site Health Summary
        2. Average SEO Score across all pages
        3. Common Issues Across Pages
        4. Technical SEO Analysis
        5. Content Quality Analysis
        6. Internal Linking Structure
        7. Mobile Optimization
        8. Site Performance Analysis
        9. Priority Recommendations (sorted by potential impact)
        10. Quick Wins (easy fixes that can have immediate impact)
        11. Long-term Strategy Recommendations
        
        Format your analysis in a clear, structured way with headings and bullet points as appropriate.`
      }
    ];
    
    workflowLogger.info('Generating final analysis', { slug });
    return await this._callOpenAIWithRetry(messages);
  }

  async _callOpenAIWithRetry(messages, retries = config.retries.maxAttempts) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        workflowLogger.debug('OpenAI API call attempt', { 
          attempt, 
          maxRetries: retries 
        });
        
        const response = await this.openai.chat.completions.create({
          model: config.models.openai.model,
          messages: messages,
          temperature: config.models.openai.temperature,
          max_tokens: config.models.openai.maxTokens,
        });
        
        workflowLogger.info('OpenAI API call successful', { attempt });
        return response.choices[0]?.message?.content?.trim();
      } catch (error) {
        logger.error(`OpenAI API call attempt ${attempt} failed: ${error.message}`);
        workflowLogger.error('OpenAI API call failed', {
          attempt,
          error: error.message,
          errorType: error.constructor.name
        });
        
        if (attempt === retries) {
          throw error;
        }
        
        const delay = config.retries.delayMs * Math.pow(2, attempt - 1);
        workflowLogger.debug('Waiting before retry', { delay });
        await this._delay(delay);
      }
    }
  }

  _extractSummary(analysis) {
    // Extract key metrics from the analysis
    const summaryRegex = /Average Score: (\d+\.?\d*)/;
    const match = analysis.match(summaryRegex);
    
    const summary = {
      averageScore: match ? parseFloat(match[1]) : null,
      analyzedAt: new Date().toISOString()
    };
    
    workflowLogger.debug('Extracted summary', summary);
    return summary;
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AuditService();