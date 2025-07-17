// src/services/auditService.js - Fixed version with clean output parsing
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

  // Site-wide analysis - cleaned up
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

  // Individual page analysis with better parsing
  async analyzeIndividualPages(pageData, slug) {
    try {
      workflowLogger.info('Starting individual page analysis', {
        slug,
        pageCount: pageData.length
      });

      const perPagePrompt = await this._getPerPagePrompt();
      const batchSize = 3; // Reduced batch size for better parsing
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
          
          if (i < batches.length - 1) {
            workflowLogger.debug('Waiting between batches', { delay: 3000 });
            await this._delay(3000);
          }
          
        } catch (batchError) {
          workflowLogger.error('Batch analysis failed', {
            slug,
            batchNumber,
            error: batchError.message
          });
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
      return this._getDefaultPerPagePrompt();
    }
  }

  _getDefaultPerPagePrompt() {
    return `You are an expert SEO consultant. Analyze each page and provide a structured response.

For each page, provide EXACTLY this format (no extra characters or formatting):

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
- [issue 3]
QUICK WINS:
- [win 1]
- [win 2]
- [win 3]
RECOMMENDATIONS:
- [recommendation 1]
- [recommendation 2]
- [recommendation 3]
PRIORITY: [High/Medium/Low]
---

Important: Use only plain text, no special formatting, no asterisks, no bold markers.`;
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
    }));

    const messages = [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: `Analyze these ${batch.length} pages from website: ${slug}

${JSON.stringify(batchData, null, 2)}

Please provide the analysis in the exact format specified, with no extra formatting or special characters.`
      }
    ];

    try {
      workflowLogger.debug('Sending batch to OpenAI', {
        slug,
        batchNumber,
        pageCount: batch.length
      });

      const response = await this._callOpenAIWithRetry(messages);
      const cleanResponse = this._cleanAnalysisText(response);
      const parsedResults = this._parsePageAnalysisResponse(cleanResponse, batch);

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
      // Split response by page separators and clean
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
      // Extract URL (use the one from analysis if available)
      const urlMatch = analysisText.match(/URL:\s*(.+)/i);
      if (urlMatch) {
        data.url = urlMatch[1].trim();
      }

      // Extract SEO score with better parsing
      const scoreMatch = analysisText.match(/SEO SCORE:\s*(\d+)/i);
      if (scoreMatch) {
        data.seoScore = parseInt(scoreMatch[1]);
      } else {
        // Default score based on basic factors
        data.seoScore = this._calculateBasicScore(originalPage);
      }

      // Extract issues - clean format
      const issuesMatch = analysisText.match(/CRITICAL ISSUES:(.*?)(?=QUICK WINS:|RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.issues = [];
      if (issuesMatch) {
        const issuesText = issuesMatch[1];
        const issues = issuesText.split('\n')
          .map(line => line.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '').trim())
          .filter(line => line.length > 0 && !line.match(/^\*+$/))
          .slice(0, 5);
        data.issues = issues;
      }

      // Extract quick wins - clean format
      const quickWinsMatch = analysisText.match(/QUICK WINS:(.*?)(?=RECOMMENDATIONS:|PRIORITY:|$)/s);
      data.quickWins = [];
      if (quickWinsMatch) {
        const quickWinsText = quickWinsMatch[1];
        const wins = quickWinsText.split('\n')
          .map(line => line.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '').trim())
          .filter(line => line.length > 0 && !line.match(/^\*+$/))
          .slice(0, 3);
        data.quickWins = wins;
      }

      // Extract recommendations - clean format
      const recommendationsMatch = analysisText.match(/RECOMMENDATIONS:(.*?)(?=PRIORITY:|$)/s);
      data.recommendations = [];
      if (recommendationsMatch) {
        const recsText = recommendationsMatch[1];
        const recs = recsText.split('\n')
          .map(line => line.replace(/^-\s*/, '').replace(/^\d+\.\s*/, '').trim())
          .filter(line => line.length > 0 && !line.match(/^\*+$/))
          .slice(0, 5);
        data.recommendations = recs;
      }

      // Extract priority
      const priorityMatch = analysisText.match(/PRIORITY:\s*(High|Medium|Low)/i);
      data.priority = priorityMatch ? priorityMatch[1] : 'Medium';

      // Calculate estimated impact
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
    let score = 50; // Base score

    // Title check
    if (pageData.Title && pageData.Title.length > 0) score += 15;
    
    // Meta description check
    if (pageData['Meta Description 1'] && pageData['Meta Description 1'].length > 0) score += 15;
    
    // H1 check
    if (pageData['H1-1'] && pageData['H1-1'].length > 0) score += 10;
    
    // Word count check
    const wordCount = parseInt(pageData['Word Count']) || 0;
    if (wordCount > 300) score += 10;
    
    // Status code check
    if (pageData['Status Code'] === '200') score += 10;

    return Math.min(100, score);
  }

  _calculateEstimatedImpact(score, priority) {
    if (!score) return 'Unknown';
    
    if (score < 50 && priority === 'High') return 'Very High';
    if (score < 60 && priority === 'High') return 'High';
    if (score < 70 && priority === 'Medium') return 'Medium';
    if (score < 80 && priority === 'Low') return 'Low';
    return 'Minimal';
  }

  // Enhanced text cleaning
  _cleanAnalysisText(text) {
    if (!text) return '';
    
    return text
      // Remove multiple asterisks and special characters
      .replace(/\*{2,}/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      // Remove non-ASCII characters except basic punctuation
      .replace(/[^\x20-\x7E\n\r\t]/g, '')
      // Clean up numbering issues
      .replace(/^\d+\.\s*\*+\s*/gm, '')
      .replace(/^-\s*\*+\s*/gm, '- ')
      // Clean up multiple spaces and newlines
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      // Remove empty list items
      .replace(/^-\s*$/gm, '')
      .replace(/^\d+\.\s*$/gm, '')
      // Split and clean each line
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  // Rest of the methods remain the same...
  async _analyzeChunks(chunks, promptTemplate, slug) {
    const concurrencyLimit = 2;
    const results = [];
    
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const batch = chunks.slice(i, i + concurrencyLimit);
      const batchNumber = Math.floor(i / concurrencyLimit) + 1;
      const totalBatches = Math.ceil(chunks.length / concurrencyLimit);
      
      const batchPromises = batch.map((chunk, batchIndex) => {
        const chunkNumber = i + batchIndex + 1;
        return this._analyzeChunk(chunk, promptTemplate, slug, chunkNumber, chunks.length);
      });
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        if (i + concurrencyLimit < chunks.length) {
          await this._delay(3000);
        }
      } catch (error) {
        logger.error(`Chunk batch ${batchNumber} analysis failed: ${error.message}`);
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
    
    const response = await this._callOpenAIWithRetry(messages);
    return this._cleanAnalysisText(response);
  }

  async _generateFinalAnalysis(chunkResults, slug) {
    const messages = [
      { 
        role: 'system', 
        content: 'You are an expert SEO analyst. Provide a comprehensive site-wide SEO assessment. Use only standard ASCII characters, no special formatting.' 
      },
      {
        role: 'user',
        content: `Based on the page analyses for website: ${slug}, provide a comprehensive SEO analysis including:
        
        1. Overall Site Health Summary
        2. Average SEO Score across all pages
        3. Common Issues Across Pages
        4. Technical SEO Analysis
        5. Content Quality Analysis
        6. Priority Recommendations
        7. Quick Wins
        8. Long-term Strategy
        
        Use clear headings and bullet points. No special characters or formatting.`
      }
    ];
    
    const analysis = await this._callOpenAIWithRetry(messages);
    return this._cleanAnalysisText(analysis);
  }

  async _callOpenAIWithRetry(messages, retries = config.retries.maxAttempts) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: config.models.openai.model,
          messages: messages,
          temperature: config.models.openai.temperature,
          max_tokens: config.models.openai.maxTokens,
        });
        
        return response.choices[0]?.message?.content?.trim();
      } catch (error) {
        logger.error(`OpenAI API call attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === retries) {
          throw error;
        }
        
        const delay = Math.min(config.retries.delayMs * Math.pow(1.5, attempt - 1), 10000);
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