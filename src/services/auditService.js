// src/services/auditService.js - Enhanced with per-page analysis capability
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

  // Existing method for site-wide analysis
  async analyzeCSVData(csvData, slug) {
    try {
      const promptTemplate = await fileService.readFile(config.files.promptPath);
      const chunks = chunkService.chunkRowsByTokenCount(csvData, config.models.chunking.tokenLimit);
      
      logger.info(`CSV split into ${chunks.length} chunks`);
      workflowLogger.info('Data chunked for site analysis', { 
        chunkCount: chunks.length,
        slug 
      });
      
      const chunkResults = await this._analyzeChunks(chunks, promptTemplate, slug);
      const finalAnalysis = await this._generateFinalAnalysis(chunkResults, slug);
      
      return {
        chunkResults,
        finalAnalysis,
        summary: this._extractSummary(finalAnalysis)
      };
    } catch (error) {
      logger.error(`Site analysis failed: ${error.message}`);
      workflowLogger.error('Site analysis failed', { 
        slug,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  // NEW: Individual page analysis method
  async analyzeIndividualPages(pageData, slug) {
    try {
      workflowLogger.info('Starting individual page analysis', {
        slug,
        pageCount: pageData.length
      });

      // Load specialized per-page prompt
      const perPagePrompt = await this._getPerPagePrompt();
      
      // Process pages in smaller batches to avoid token limits
      const batchSize = 5; // Analyze 5 pages at a time
      const batches = this._createPageBatches(pageData, batchSize);
      
      workflowLogger.info('Created page batches', {
        slug,
        totalPages: pageData.length,
        batchCount: batches.length,
        batchSize
      });

      const allPageAnalyses = [];
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        
        workflowLogger.info(`Processing page batch ${batchNumber}/${batches.length}`, {
          slug,
          batchSize: batch.length
        });

        try {
          const batchResults = await this._analyzePageBatch(batch, perPagePrompt, slug, batchNumber);
          allPageAnalyses.push(...batchResults);
          
          // Add delay between batches to respect rate limits
          if (i < batches.length - 1) {
            workflowLogger.debug('Waiting between batches', { delay: 2000 });
            await this._delay(2000);
          }
          
        } catch (batchError) {
          workflowLogger.error('Batch analysis failed', {
            slug,
            batchNumber,
            error: batchError.message
          });
          
          // Continue with other batches even if one fails
          continue;
        }
      }

      workflowLogger.info('Individual page analysis completed', {
        slug,
        totalPagesAnalyzed: allPageAnalyses.length,
        expectedPages: pageData.length
      });

      return allPageAnalyses;

    } catch (error) {
      logger.error(`Individual page analysis failed: ${error.message}`);
      workflowLogger.error('Individual page analysis failed', {
        slug,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async _getPerPagePrompt() {
    const perPagePromptPath = path.join(__dirname, '../../prompts', 'per_page_analysis_prompt.txt');
    
    try {
      return await fileService.readFile(perPagePromptPath);
    } catch (error) {
      // If custom prompt doesn't exist, use default
      return this._getDefaultPerPagePrompt();
    }
  }

  _getDefaultPerPagePrompt() {
    return `You are an expert SEO consultant analyzing individual web pages. For each page provided, give a detailed, actionable analysis.

For each page, provide:

1. **SEO SCORE** (0-100): Based on technical and content factors
2. **PAGE TITLE ANALYSIS**: Quality, length, keyword optimization
3. **META DESCRIPTION ANALYSIS**: Presence, quality, length, call-to-action
4. **CONTENT ANALYSIS**: Word count, structure, keyword usage, readability
5. **TECHNICAL SEO**: Status code, indexability, canonical tags, load time
6. **ON-PAGE ELEMENTS**: H1-H6 structure, image alt text, internal linking
7. **CRITICAL ISSUES**: List specific problems (max 5)
8. **QUICK WINS**: Easy fixes with high impact (max 3)
9. **DETAILED RECOMMENDATIONS**: Specific actions to improve ranking (max 5)
10. **PRIORITY**: High/Medium/Low based on traffic potential and fix difficulty

Format each page analysis as:
---
URL: [page_url]
SEO SCORE: [score]/100
TITLE: [analysis]
META DESCRIPTION: [analysis]
CONTENT: [analysis]
TECHNICAL: [analysis]
ON-PAGE: [analysis]
CRITICAL ISSUES:
- [issue 1]
- [issue 2]
QUICK WINS:
- [quick win 1]
- [quick win 2]
RECOMMENDATIONS:
- [recommendation 1]
- [recommendation 2]
PRIORITY: [High/Medium/Low]
---

Be specific, actionable, and focus on improvements that will impact search rankings.`;
  }

  _createPageBatches(pageData, batchSize) {
    const batches = [];
    for (let i = 0; i < pageData.length; i += batchSize) {
      batches.push(pageData.slice(i, i + batchSize));
    }
    return batches;
  }

  async _analyzePageBatch(batch, prompt, slug, batchNumber) {
    const batchData = batch.map(page => ({
      url: page.Address || page.URL,
      title: page.Title || 'No title',
      metaDescription: page['Meta Description 1'] || 'Missing',
      wordCount: page['Word Count'] || '0',
      h1: page['H1-1'] || 'Missing',
      h2: page['H1-2'] || '',
      statusCode: page['Status Code'] || '',
      indexability: page.Indexability || '',
      canonical: page['Canonical Link Element 1'] || '',
      inlinks: page['Inlinks'] || '0',
      outlinks: page['Outlinks'] || '0',
      lastModified: page['Last Modified'] || '',
      // Add more fields as needed
    }));

    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Analyze these ${batch.length} pages from website: ${slug}\n\n${JSON.stringify(batchData, null, 2)}`
      }
    ];

    try {
      workflowLogger.debug('Sending batch to OpenAI', {
        slug,
        batchNumber,
        pageCount: batch.length
      });

      const response = await this._callOpenAIWithRetry(messages);
      const parsedResults = this._parsePageAnalysisResponse(response, batch);

      workflowLogger.info('Batch analysis completed', {
        slug,
        batchNumber,
        parsedResults: parsedResults.length
      });

      return parsedResults;

    } catch (error) {
      workflowLogger.error('Batch OpenAI call failed', {
        slug,
        batchNumber,
        error: error.message
      });
      throw error;
    }
  }

  _parsePageAnalysisResponse(response, originalBatch) {
    const results = [];
    
    try {
      // Split response by page separators
      const pageAnalyses = response.split('---').filter(section => section.trim());
      
      pageAnalyses.forEach((analysis, index) => {
        try {
          const pageData = this._extractPageData(analysis, originalBatch[index]);
          if (pageData) {
            results.push(pageData);
          }
        } catch (parseError) {
          workflowLogger.warn('Failed to parse individual page analysis', {
            index,
            error: parseError.message
          });
        }
      });

    } catch (error) {
      workflowLogger.error('Failed to parse page analysis response', {
        error: error.message,
        responseLength: response.length
      });
    }

    return results;
  }

  _extractPageData(analysisText, originalPage) {
    const data = {
      url: originalPage?.Address || originalPage?.URL || 'Unknown',
      title: originalPage?.Title || 'No title',
      metaDescription: originalPage?.['Meta Description 1'] || 'Missing'
    };

    try {
      // Extract SEO score
      const scoreMatch = analysisText.match(/SEO SCORE:\s*(\d+)/i);
      data.seoScore = scoreMatch ? parseInt(scoreMatch[1]) : null;

      // Extract critical issues
      const issuesMatch = analysisText.match(/CRITICAL ISSUES:(.*?)(?=QUICK WINS:|RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.issues = issuesMatch ? 
        issuesMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 5) : [];

      // Extract quick wins
      const quickWinsMatch = analysisText.match(/QUICK WINS:(.*?)(?=RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.quickWins = quickWinsMatch ? 
        quickWinsMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3) : [];

      // Extract recommendations
      const recommendationsMatch = analysisText.match(/RECOMMENDATIONS:(.*?)(?=PRIORITY:|$)/s);
      data.recommendations = recommendationsMatch ? 
        recommendationsMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 5) : [];

      // Extract priority
      const priorityMatch = analysisText.match(/PRIORITY:\s*(High|Medium|Low)/i);
      data.priority = priorityMatch ? priorityMatch[1] : 'Medium';

      // Estimate impact based on score and priority
      data.estimatedImpact = this._calculateEstimatedImpact(data.seoScore, data.priority);

    } catch (extractError) {
      workflowLogger.warn('Failed to extract page data fields', {
        url: data.url,
        error: extractError.message
      });
    }

    return data;
  }

  _calculateEstimatedImpact(score, priority) {
    if (!score) return 'Unknown';
    
    if (score < 50 && priority === 'High') return 'Very High';
    if (score < 60 && priority === 'High') return 'High';
    if (score < 70 && priority === 'Medium') return 'Medium';
    if (score < 80 && priority === 'Low') return 'Low';
    return 'Minimal';
  }

  // Existing methods (keep unchanged)
  async _analyzeChunks(chunks, promptTemplate, slug) {
    const concurrencyLimit = 2; // Reduced from 3 to help with rate limits
    const results = [];
    
    workflowLogger.info('Starting parallel chunk processing', {
      totalChunks: chunks.length,
      concurrencyLimit: concurrencyLimit,
      slug
    });
    
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const batch = chunks.slice(i, i + concurrencyLimit);
      const batchNumber = Math.floor(i / concurrencyLimit) + 1;
      const totalBatches = Math.ceil(chunks.length / concurrencyLimit);
      
      workflowLogger.info(`Processing chunk batch ${batchNumber}/${totalBatches}`, {
        slug,
        batchSize: batch.length
      });
      
      const batchPromises = batch.map((chunk, batchIndex) => {
        const chunkNumber = i + batchIndex + 1;
        return this._analyzeChunk(chunk, promptTemplate, slug, chunkNumber, chunks.length);
      });
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        workflowLogger.info(`Completed chunk batch ${batchNumber}/${totalBatches}`, {
          slug,
          processed: Math.min(i + concurrencyLimit, chunks.length),
          total: chunks.length,
          remaining: Math.max(0, chunks.length - (i + concurrencyLimit))
        });
        
        if (i + concurrencyLimit < chunks.length) {
          workflowLogger.debug('Waiting before next batch', { 
            delay: 3000 // Increased delay to help with rate limits
          });
          await this._delay(3000);
        }
      } catch (error) {
        logger.error(`Chunk batch ${batchNumber} analysis failed: ${error.message}`);
        workflowLogger.error('Chunk batch analysis failed', {
          batchNumber,
          slug,
          error: error.message
        });
        throw error;
      }
    }
    
    workflowLogger.info('All chunks processed successfully', {
      slug,
      totalChunks: chunks.length,
      totalResults: results.length
    });
    
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
        content: 'You are an expert SEO analyst. Based on all individual page analyses, provide a comprehensive site-wide SEO assessment. Use only standard ASCII characters in your response.' 
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
        
        Format your analysis in a clear, structured way with headings and bullet points as appropriate. Use only standard characters - no special symbols or formatting characters.`
      }
    ];
    
    workflowLogger.info('Generating final analysis', { slug });
    const analysis = await this._callOpenAIWithRetry(messages);
    
    return this._cleanAnalysisText(analysis);
  }

  _cleanAnalysisText(text) {
    if (!text) return '';
    
    return text
      .replace(/^[^\w\s#\-\*\d]+/gm, '')
      .replace(/[^\x20-\x7E\n\r\t]/g, '')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .trim();
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
        
        const delay = Math.min(config.retries.delayMs * Math.pow(1.5, attempt - 1), 10000);
        workflowLogger.debug('Waiting before retry', { delay });
        await this._delay(delay);
      }
    }
  }

  _extractSummary(analysis) {
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