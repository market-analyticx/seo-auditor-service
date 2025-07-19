// src/services/auditService.js - Optimized for speed and efficiency
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
    
    workflowLogger.info('OpenAI client initialized for fast processing');
  }

  // Optimized site-wide analysis with intelligent chunking
  async analyzeCSVData(csvData, slug) {
    try {
      const promptTemplate = await fileService.readFile(config.files.promptPath);
      
      // Use smart chunking based on data size
      const chunks = chunkService.smartChunk(csvData, 3000, 50); // Larger token limit, smaller max chunks
      
      logger.info(`Smart chunking: ${chunks.length} chunks for ${csvData.length} rows`);
      workflowLogger.info('Smart chunking completed', { 
        chunkCount: chunks.length,
        slug,
        originalRows: csvData.length,
        averageChunkSize: chunks.length > 0 ? Math.round(csvData.length / chunks.length) : 0
      });
      
      // Analyze chunks with improved concurrency
      const chunkResults = await this._analyzeChunksOptimized(chunks, promptTemplate, slug);
      const finalAnalysis = await this._generateFinalAnalysis(chunkResults, slug);
      
      return {
        chunkResults,
        finalAnalysis: this._cleanAnalysisText(finalAnalysis),
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

  // Optimized individual page analysis with better batching
  async analyzeIndividualPages(pageData, slug) {
    try {
      workflowLogger.info('Starting optimized individual page analysis', {
        slug,
        pageCount: pageData.length
      });

      const perPagePrompt = await this._getPerPagePrompt();
      
      // Optimize batch size based on data volume
      let batchSize = 5; // Increased from 3
      if (pageData.length > 200) {
        batchSize = 10; // Larger batches for big sites
      } else if (pageData.length < 50) {
        batchSize = 3; // Smaller batches for small sites
      }
      
      const batches = this._createPageBatches(pageData, batchSize);
      
      workflowLogger.info('Optimized page batching', {
        slug,
        totalPages: pageData.length,
        batchCount: batches.length,
        batchSize,
        estimatedDuration: `${Math.round(batches.length * 8 / 60)} minutes`
      });

      const allPageAnalyses = [];
      
      // Process batches with better error handling and progress tracking
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;
        
        // Progress logging every 5 batches to reduce noise
        if (batchNumber % 5 === 1 || batchNumber === batches.length) {
          workflowLogger.info(`Processing page batch ${batchNumber}/${batches.length}`, {
            slug,
            progress: `${Math.round((batchNumber / batches.length) * 100)}%`,
            batchSize: batch.length
          });
        }

        try {
          const batchResults = await this._analyzePageBatchOptimized(batch, perPagePrompt, slug, batchNumber);
          allPageAnalyses.push(...batchResults);
          
          // Reduced delay between batches for speed
          if (i < batches.length - 1) {
            await this._delay(2000); // Reduced from 3000ms to 2000ms
          }
          
        } catch (batchError) {
          workflowLogger.error('Batch analysis failed', {
            slug,
            batchNumber,
            error: batchError.message
          });
          // Continue with next batch instead of failing completely
          continue;
        }
      }

      workflowLogger.info('Optimized page analysis completed', {
        slug,
        totalPagesAnalyzed: allPageAnalyses.length,
        expectedPages: pageData.length,
        successRate: `${Math.round((allPageAnalyses.length / pageData.length) * 100)}%`
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

  // Optimized chunk analysis with better concurrency
  async _analyzeChunksOptimized(chunks, promptTemplate, slug) {
    const concurrencyLimit = 3; // Increased from 2
    const results = [];
    
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const batch = chunks.slice(i, i + concurrencyLimit);
      const batchNumber = Math.floor(i / concurrencyLimit) + 1;
      const totalBatches = Math.ceil(chunks.length / concurrencyLimit);
      
      // Progress logging every 5 batches
      if (batchNumber % 5 === 1 || batchNumber === totalBatches) {
        workflowLogger.info(`Processing chunk batch ${batchNumber}/${totalBatches}`, {
          slug,
          progress: `${Math.round((batchNumber / totalBatches) * 100)}%`
        });
      }
      
      const batchPromises = batch.map((chunk, batchIndex) => {
        const chunkNumber = i + batchIndex + 1;
        return this._analyzeChunk(chunk, promptTemplate, slug, chunkNumber, chunks.length);
      });
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Reduced delay between batches
        if (i + concurrencyLimit < chunks.length) {
          await this._delay(2000); // Reduced from 3000ms
        }
      } catch (error) {
        logger.error(`Chunk batch ${batchNumber} analysis failed: ${error.message}`);
        // Continue with next batch
        continue;
      }
    }
    
    return results;
  }

  // Optimized page batch analysis
  async _analyzePageBatchOptimized(batch, prompt, slug, batchNumber) {
    const batchData = batch.map(page => ({
      url: page.Address || page.URL,
      title: page.Title || 'No title',
      metaDescription: page['Meta Description 1'] || 'Missing',
      wordCount: page['Word Count'] || '0',
      h1: page['H1-1'] || 'Missing',
      statusCode: page['Status Code'] || '',
      indexability: page.Indexability || '',
    }));

    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Analyze these ${batch.length} pages from ${slug}:

${JSON.stringify(batchData, null, 2)}

Provide analysis in the exact format specified.`
      }
    ];

    try {
      const response = await this._callOpenAIWithRetry(messages, 2); // Reduced retries from 3 to 2
      const cleanResponse = this._cleanAnalysisText(response);
      const parsedResults = this._parsePageAnalysisResponse(cleanResponse, batch);

      return parsedResults;

    } catch (error) {
      workflowLogger.error('Optimized batch OpenAI call failed', {
        slug,
        batchNumber,
        error: error.message
      });
      throw error;
    }
  }

  async _getPerPagePrompt() {
    const perPagePromptPath = path.join(__dirname, '../../prompts', 'per_page_analysis_prompt.txt');
    
    try {
      return await fileService.readFile(perPagePromptPath);
    } catch (error) {
      return this._getDefaultPerPagePrompt();
    }
  }

  _getDefaultPerPagePrompt() {
    return `You are an expert SEO consultant. Analyze each page and provide a structured response.

For each page, provide EXACTLY this format (no extra characters):

---
URL: [page_url]
SEO SCORE: [score]/100
CRITICAL ISSUES:
- [issue 1]
- [issue 2]
QUICK WINS:
- [win 1] 
- [win 2]
RECOMMENDATIONS:
- [recommendation 1]
- [recommendation 2]
PRIORITY: [High/Medium/Low]
---

Use only plain text, no special formatting.`;
  }

  _createPageBatches(pageData, batchSize) {
    const batches = [];
    for (let i = 0; i < pageData.length; i += batchSize) {
      batches.push(pageData.slice(i, i + batchSize));
    }
    return batches;
  }

  _parsePageAnalysisResponse(response, originalBatch) {
    const results = [];
    
    try {
      const pageAnalyses = response.split('---').filter(section => section.trim());
      
      pageAnalyses.forEach((analysis, index) => {
        try {
          const pageData = this._extractPageData(analysis, originalBatch[index]);
          if (pageData && pageData.url) {
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
      // Extract URL
      const urlMatch = analysisText.match(/URL:\s*(.+)/i);
      if (urlMatch) {
        data.url = urlMatch[1].trim();
      }

      // Extract SEO score
      const scoreMatch = analysisText.match(/SEO SCORE:\s*(\d+)/i);
      if (scoreMatch) {
        data.seoScore = parseInt(scoreMatch[1]);
      } else {
        data.seoScore = this._calculateBasicScore(originalPage);
      }

      // Extract issues
      const issuesMatch = analysisText.match(/CRITICAL ISSUES:(.*?)(?=QUICK WINS:|RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.issues = [];
      if (issuesMatch) {
        const issues = issuesMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3); // Limit to 3 for speed
        data.issues = issues;
      }

      // Extract quick wins
      const quickWinsMatch = analysisText.match(/QUICK WINS:(.*?)(?=RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.quickWins = [];
      if (quickWinsMatch) {
        const wins = quickWinsMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3);
        data.quickWins = wins;
      }

      // Extract recommendations
      const recommendationsMatch = analysisText.match(/RECOMMENDATIONS:(.*?)(?=PRIORITY:|$)/s);
      data.recommendations = [];
      if (recommendationsMatch) {
        const recs = recommendationsMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3);
        data.recommendations = recs;
      }

      // Extract priority
      const priorityMatch = analysisText.match(/PRIORITY:\s*(High|Medium|Low)/i);
      data.priority = priorityMatch ? priorityMatch[1] : 'Medium';

      data.estimatedImpact = this._calculateEstimatedImpact(data.seoScore, data.priority);

    } catch (extractError) {
      workflowLogger.warn('Failed to extract page data fields', {
        url: data.url,
        error: extractError.message
      });
    }

    return data;
  }

  _calculateBasicScore(pageData) {
    let score = 50;
    if (pageData.Title && pageData.Title.length > 0) score += 15;
    if (pageData['Meta Description 1'] && pageData['Meta Description 1'].length > 0) score += 15;
    if (pageData['H1-1'] && pageData['H1-1'].length > 0) score += 10;
    const wordCount = parseInt(pageData['Word Count']) || 0;
    if (wordCount > 300) score += 10;
    if (pageData['Status Code'] === '200') score += 10;
    return Math.min(100, score);
  }

  _calculateEstimatedImpact(score, priority) {
    if (!score) return 'Unknown';
    if (score < 50 && priority === 'High') return 'Very High';
    if (score < 60 && priority === 'High') return 'High';
    if (score < 70 && priority === 'Medium') return 'Medium';
    return 'Low';
  }

  _cleanAnalysisText(text) {
    if (!text) return '';
    
    return text
      .replace(/\*{2,}/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/[^\x20-\x7E\n\r\t]/g, '')
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^-\s*\*+\s*/gm, '- ')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  async _analyzeChunk(chunk, promptTemplate, slug, chunkNumber, totalChunks) {
    const messages = [
      { role: 'system', content: promptTemplate },
      {
        role: 'user',
        content: `Chunk ${chunkNumber}/${totalChunks} for ${slug}:\n\n${JSON.stringify(chunk, null, 2)}`
      }
    ];
    
    const response = await this._callOpenAIWithRetry(messages, 2);
    return this._cleanAnalysisText(response);
  }

  async _generateFinalAnalysis(chunkResults, slug) {
    const messages = [
      { 
        role: 'system', 
        content: 'You are an expert SEO analyst. Provide a comprehensive site-wide SEO assessment. Use only standard ASCII characters.' 
      },
      {
        role: 'user',
        content: `Based on analyses for ${slug}, provide a comprehensive SEO analysis with:
        
1. Overall Site Health Summary
2. Average SEO Score
3. Common Issues
4. Technical SEO Analysis
5. Priority Recommendations
6. Quick Wins
7. Long-term Strategy

Use clear headings and bullet points. Keep it concise but comprehensive.`
      }
    ];
    
    const analysis = await this._callOpenAIWithRetry(messages, 2);
    return this._cleanAnalysisText(analysis);
  }

  async _callOpenAIWithRetry(messages, retries = 2) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: config.models.openai.model,
          messages: messages,
          temperature: config.models.openai.temperature,
          max_tokens: 2000, // Reduced from 3000 for faster responses
        });
        
        return response.choices[0]?.message?.content?.trim();
      } catch (error) {
        logger.error(`OpenAI API call attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === retries) {
          throw error;
        }
        
        // Shorter delay for retries
        const delay = 1000 * attempt; // 1s, 2s
        await this._delay(delay);
      }
    }
  }

  _extractSummary(analysis) {
    const summaryRegex = /Average Score: (\d+\.?\d*)/;
    const match = analysis.match(summaryRegex);
    
    return {
      averageScore: match ? parseFloat(match[1]) : null,
      analyzedAt: new Date().toISOString()
    };
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new AuditService();