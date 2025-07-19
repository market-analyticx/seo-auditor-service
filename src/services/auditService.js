// src/services/auditService.js - Fast and comprehensive for all website sizes
const dotenv = require('dotenv');
const path = require('path');

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

  // Optimized site-wide analysis with smart chunking
  async analyzeCSVData(csvData, slug) {
    try {
      const promptTemplate = await fileService.readFile(config.files.promptPath);
      
      // Smart chunking based on data size - balance speed with API limits
      let chunks;
      if (csvData.length > 300) {
        // Large dataset: use size-based chunking for speed
        chunks = chunkService.chunkBySize(csvData, 25); // 25 pages per chunk
        workflowLogger.info('Using size-based chunking for large dataset', { 
          slug,
          rowCount: csvData.length,
          chunkCount: chunks.length,
          method: 'size-based'
        });
      } else {
        // Smaller dataset: use smart token-based chunking
        chunks = chunkService.smartChunk(csvData, 4000); // Larger token limit for fewer chunks
        workflowLogger.info('Using smart chunking for dataset', { 
          slug,
          rowCount: csvData.length,
          chunkCount: chunks.length,
          method: 'smart'
        });
      }
      
      logger.info(`Smart chunking: ${chunks.length} chunks for ${csvData.length} rows`);
      
      // Process chunks with optimized concurrency
      const chunkResults = await this._processChunksOptimized(chunks, promptTemplate, slug);
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

  // Optimized individual page analysis
  async analyzeIndividualPages(pageData, slug) {
    try {
      workflowLogger.info('Starting optimized page analysis', {
        slug,
        pageCount: pageData.length
      });

      // Skip individual page analysis for very large sites to save time
      if (pageData.length > 1000) {
        workflowLogger.info('Skipping individual page analysis for large site', {
          slug,
          pageCount: pageData.length,
          reason: 'Performance optimization for large sites'
        });
        
        // Return basic analysis for large sites
        return this._generateBasicPageAnalysis(pageData, slug);
      }

      const perPagePrompt = await this._getPerPagePrompt();
      
      // Optimize batch size based on data volume for speed
      let batchSize = 8; // Increased default
      if (pageData.length > 200) {
        batchSize = 12; // Larger batches for bigger sites
      } else if (pageData.length < 50) {
        batchSize = 5; // Smaller batches for small sites
      }
      
      const batches = this._createPageBatches(pageData, batchSize);
      
      workflowLogger.info('Optimized batch processing', {
        slug,
        totalPages: pageData.length,
        batchCount: batches.length,
        batchSize,
        estimatedDuration: `${Math.round(batches.length * 6 / 60)} minutes`
      });

      const allPageAnalyses = [];
      const concurrentBatches = 2; // Process 2 batches concurrently for speed
      
      // Process batches with concurrency for speed
      for (let i = 0; i < batches.length; i += concurrentBatches) {
        const currentBatches = batches.slice(i, i + concurrentBatches);
        
        // Progress logging
        if (i % 10 === 0 || i + concurrentBatches >= batches.length) {
          const progress = Math.round(((i + concurrentBatches) / batches.length) * 100);
          workflowLogger.info(`Processing batches ${i + 1}-${Math.min(i + concurrentBatches, batches.length)} of ${batches.length}`, {
            slug,
            progress: `${progress}%`
          });
        }

        try {
          // Process batches concurrently
          const batchPromises = currentBatches.map((batch, batchIndex) => 
            this._analyzePageBatchOptimized(batch, perPagePrompt, slug, i + batchIndex + 1)
          );
          
          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach(result => allPageAnalyses.push(...result));
          
          // Reduced delay for speed
          if (i + concurrentBatches < batches.length) {
            await this._delay(1500); // 1.5 seconds between concurrent batches
          }
          
        } catch (batchError) {
          workflowLogger.error('Concurrent batch processing failed', {
            slug,
            batchRange: `${i + 1}-${Math.min(i + concurrentBatches, batches.length)}`,
            error: batchError.message
          });
          // Continue with next batch group
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
        error: error.message
      });
      throw error;
    }
  }

  // Generate basic analysis for large sites to maintain speed
  _generateBasicPageAnalysis(pageData, slug) {
    return pageData.slice(0, 50).map((page, index) => { // Analyze only first 50 pages
      const url = page.Address || page.URL || 'Unknown';
      const title = page.Title || 'No title';
      const metaDescription = page['Meta Description 1'] || 'Missing';
      
      // Basic scoring based on available data
      let score = 50;
      if (title && title.length > 0) score += 15;
      if (metaDescription && metaDescription.length > 0) score += 15;
      if (page['H1-1'] && page['H1-1'].length > 0) score += 10;
      if (page['Status Code'] === '200') score += 10;
      
      const wordCount = parseInt(page['Word Count']) || 0;
      if (wordCount > 300) score += 10;
      
      // Basic issues detection
      const issues = [];
      if (!title || title.length === 0) issues.push('Missing page title');
      if (!metaDescription || metaDescription.length === 0) issues.push('Missing meta description');
      if (!page['H1-1'] || page['H1-1'].length === 0) issues.push('Missing H1 tag');
      if (wordCount < 300) issues.push('Thin content');
      
      return {
        url,
        title,
        metaDescription,
        seoScore: Math.min(100, score),
        issues: issues.slice(0, 3),
        quickWins: issues.slice(0, 2),
        recommendations: [`Optimize ${issues[0] || 'page structure'}`],
        priority: score < 60 ? 'High' : score < 80 ? 'Medium' : 'Low',
        estimatedImpact: score < 60 ? 'High' : 'Medium'
      };
    });
  }

  // Optimized chunk processing with better concurrency
  async _processChunksOptimized(chunks, promptTemplate, slug) {
    const concurrencyLimit = 3; // Optimal for most cases
    const results = [];
    
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const batch = chunks.slice(i, i + concurrencyLimit);
      const batchNumber = Math.floor(i / concurrencyLimit) + 1;
      const totalBatches = Math.ceil(chunks.length / concurrencyLimit);
      
      // Progress logging
      if (batchNumber % 3 === 1 || batchNumber === totalBatches) {
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
        
        // Shorter delay for speed
        if (i + concurrencyLimit < chunks.length) {
          await this._delay(1500); // 1.5 seconds
        }
      } catch (error) {
        logger.error(`Chunk batch ${batchNumber} failed: ${error.message}`);
        // Continue with next batch
        continue;
      }
    }
    
    return results;
  }

  // Optimized page batch analysis
  async _analyzePageBatchOptimized(batch, prompt, slug, batchNumber) {
    // Simplified data structure for faster processing
    const batchData = batch.map(page => ({
      url: page.Address || page.URL,
      title: page.Title || 'No title',
      metaDescription: page['Meta Description 1'] || 'Missing',
      wordCount: page['Word Count'] || '0',
      h1: page['H1-1'] || 'Missing',
      statusCode: page['Status Code'] || '',
      indexability: page.Indexability || ''
    }));

    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Analyze these ${batch.length} pages from ${slug}:

${JSON.stringify(batchData, null, 2)}

Provide concise analysis in the specified format.`
      }
    ];

    try {
      const response = await this._callOpenAIWithRetry(messages, 2);
      const cleanResponse = this._cleanAnalysisText(response);
      const parsedResults = this._parsePageAnalysisResponse(cleanResponse, batch);

      return parsedResults;

    } catch (error) {
      workflowLogger.error('Batch OpenAI call failed', {
        slug,
        batchNumber,
        error: error.message
      });
      // Return basic analysis as fallback
      return this._generateBasicPageAnalysis(batch, slug);
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
    return `You are an expert SEO consultant. Analyze each page quickly and provide structured responses.

For each page, provide EXACTLY this format:

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

Keep responses concise. Use plain text only.`;
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
          // Fallback to basic analysis for this page
          if (originalBatch[index]) {
            const basicData = this._generateBasicPageAnalysis([originalBatch[index]], 'fallback')[0];
            results.push(basicData);
          }
        }
      });

    } catch (error) {
      // Return basic analysis as complete fallback
      return this._generateBasicPageAnalysis(originalBatch, 'fallback');
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
      data.seoScore = scoreMatch ? parseInt(scoreMatch[1]) : this._calculateBasicScore(originalPage);

      // Extract issues (limit for speed)
      const issuesMatch = analysisText.match(/CRITICAL ISSUES:(.*?)(?=QUICK WINS:|RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.issues = [];
      if (issuesMatch) {
        data.issues = issuesMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3);
      }

      // Extract quick wins
      const quickWinsMatch = analysisText.match(/QUICK WINS:(.*?)(?=RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.quickWins = [];
      if (quickWinsMatch) {
        data.quickWins = quickWinsMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 2);
      }

      // Extract recommendations
      const recommendationsMatch = analysisText.match(/RECOMMENDATIONS:(.*?)(?=PRIORITY:|$)/s);
      data.recommendations = [];
      if (recommendationsMatch) {
        data.recommendations = recommendationsMatch[1].split('\n')
          .map(line => line.replace(/^-\s*/, '').trim())
          .filter(line => line.length > 0)
          .slice(0, 3);
      }

      // Extract priority
      const priorityMatch = analysisText.match(/PRIORITY:\s*(High|Medium|Low)/i);
      data.priority = priorityMatch ? priorityMatch[1] : 'Medium';

      data.estimatedImpact = this._calculateEstimatedImpact(data.seoScore, data.priority);

    } catch (extractError) {
      // Use basic scoring as fallback
      data.seoScore = this._calculateBasicScore(originalPage);
      data.issues = ['Analysis parsing incomplete'];
      data.quickWins = ['Review page manually'];
      data.recommendations = ['Manual SEO review needed'];
      data.priority = 'Medium';
      data.estimatedImpact = 'Medium';
    }

    return data;
  }

  _calculateBasicScore(pageData) {
    let score = 50;
    if (pageData?.Title && pageData.Title.length > 0) score += 15;
    if (pageData?.['Meta Description 1'] && pageData['Meta Description 1'].length > 0) score += 15;
    if (pageData?.['H1-1'] && pageData['H1-1'].length > 0) score += 10;
    const wordCount = parseInt(pageData?.['Word Count']) || 0;
    if (wordCount > 300) score += 10;
    if (pageData?.['Status Code'] === '200') score += 10;
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
        content: 'You are an expert SEO analyst. Provide a comprehensive but concise site-wide SEO assessment.' 
      },
      {
        role: 'user',
        content: `Based on analyses for ${slug}, provide a comprehensive SEO analysis including:
        
1. Overall Site Health Summary
2. Average SEO Score
3. Common Issues
4. Technical SEO Analysis
5. Priority Recommendations
6. Quick Wins

Keep it comprehensive but concise. Use clear headings.`
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
          temperature: 0.1, // Low temperature for consistency and speed
          max_tokens: 1800, // Reduced for faster responses
        });
        
        return response.choices[0]?.message?.content?.trim();
      } catch (error) {
        logger.error(`OpenAI API call attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === retries) {
          throw error;
        }
        
        // Short delay for retries
        await this._delay(1000 * attempt);
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