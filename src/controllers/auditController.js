const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const auditService = require('../services/auditService');
const fileService = require('../services/fileService');
const reportService = require('../services/reportService');
const path = require('path');
const config = require('../config');
const auditConfig = require('../config/audit');

class AuditController {
  async analyzeWebsite(slug) {
    const startTime = Date.now();
    logger.info(`Starting SEO analysis for slug: ${slug}`);
    workflowLogger.info('Starting SEO analysis', { slug });

    try {
      // Load CSV data
      const csvPath = path.join(config.paths.exportsDir, slug, auditConfig.files.csvFilename);
      workflowLogger.debug('Loading CSV file', { csvPath });
      
      const csvData = await fileService.readAndParseCSV(csvPath);
      workflowLogger.info('CSV data loaded', { 
        rowCount: csvData.length, 
        slug 
      });
      
      // Perform analysis
      workflowLogger.info('Starting analysis process', { slug });
      const analysis = await auditService.analyzeCSVData(csvData, slug);
      workflowLogger.info('Analysis completed', { 
        slug,
        chunkCount: analysis.chunkResults.length 
      });
      
      // Generate report
      workflowLogger.info('Generating report', { slug });
      const reportPath = await reportService.saveComprehensiveReport(slug, analysis);
      
      // Prepare comprehensive results for response
      const comprehensiveResults = this._prepareComprehensiveResults(analysis, csvData, slug);
      
      const duration = Date.now() - startTime;
      logger.info(`SEO analysis completed in ${duration}ms`);
      workflowLogger.info('SEO analysis completed', { 
        slug, 
        duration, 
        reportPath,
        summary: analysis.summary 
      });
      
      return {
        success: true,
        reportPath,
        duration,
        slug,
        summary: analysis.summary,
        results: comprehensiveResults  // NEW: Include results in response
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`SEO analysis failed: ${error.message}`);
      workflowLogger.error('SEO analysis failed', { 
        slug, 
        error: error.message,
        duration,
        stack: error.stack 
      });
      throw error;
    }
  }

  _prepareComprehensiveResults(analysis, csvData, slug) {
  return {
    slug: slug,
    timestamp: new Date().toISOString(),
    summary: analysis.summary,
    
    // Overall site statistics
    overview: {
      totalPages: csvData.length,
      averageScore: analysis.summary.averageScore,
      analysisDate: analysis.summary.analyzedAt
    },
    
    // Individual page analyses (parsed from chunk results)
    pageAnalyses: this._parsePageAnalyses(analysis.chunkResults),
    
    // Site-wide analysis with cleaned text
    siteAnalysis: {
      fullText: this._cleanAnalysisText(analysis.finalAnalysis),
      structured: this._structureSiteAnalysis(analysis.finalAnalysis)
    },
    
    // Raw crawl data (first 10 pages for preview)
    crawlDataPreview: csvData.slice(0, 10).map(row => ({
      url: row.Address || row.URL,
      title: row.Title,
      statusCode: row['Status Code'],
      metaDescription: row['Meta Description 1'],
      h1: row['H1-1'],
      wordCount: row['Word Count'],
      indexability: row.Indexability
    })),
    
    // Statistics
    statistics: this._generateStatistics(csvData)
  };
}

// Add this new method to clean the text
_cleanAnalysisText(text) {
  if (!text) return '';
  
  return text
    // Remove any special characters at the beginning of lines
    .replace(/^[^\w\s#\-\*\d]+/gm, '')
    // Remove any non-printable characters
    .replace(/[^\x20-\x7E\n\r\t]/g, '')
    // Clean up multiple spaces
    .replace(/[ ]{2,}/g, ' ')
    // Clean up multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    // Remove any leading/trailing whitespace from each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Remove any remaining special characters that might interfere
    .replace(/[^\w\s\-\.\,\:\;\(\)\[\]\#\*\n\r]/g, '')
    // Final cleanup
    .trim();
}

  _parsePageAnalyses(chunkResults) {
    const pageAnalyses = [];
    
    chunkResults.forEach(chunk => {
      // Parse individual page analyses from the chunk text
      const pageMatches = chunk.match(/Page: (.*?)\nSEO Score: (\d+)\/100([\s\S]*?)(?=Page: |$)/g);
      
      if (pageMatches) {
        pageMatches.forEach(match => {
          const urlMatch = match.match(/Page: (.*?)\n/);
          const scoreMatch = match.match(/SEO Score: (\d+)\/100/);
          const issuesMatch = match.match(/Issues Found:([\s\S]*?)(?=Suggestions to Fix:|$)/);
          const suggestionsMatch = match.match(/Suggestions to Fix:([\s\S]*?)(?=How to Rank Better:|$)/);
          const rankingMatch = match.match(/How to Rank Better:([\s\S]*?)(?=Page Improvement Suggestions:|$)/);
          
          if (urlMatch && scoreMatch) {
            pageAnalyses.push({
              url: urlMatch[1].trim(),
              seoScore: parseInt(scoreMatch[1]),
              issues: issuesMatch ? issuesMatch[1].trim().split('\n').filter(line => line.trim()) : [],
              suggestions: suggestionsMatch ? suggestionsMatch[1].trim().split('\n').filter(line => line.trim()) : [],
              rankingTips: rankingMatch ? rankingMatch[1].trim().split('\n').filter(line => line.trim()) : []
            });
          }
        });
      }
    });
    
    return pageAnalyses;
  }

  _structureSiteAnalysis(fullAnalysis) {
    // Extract structured data from the full analysis text
    const sections = {};
    
    // Try to extract common sections
    const sectionMatches = fullAnalysis.match(/## (.*?)\n([\s\S]*?)(?=## |$)/g);
    
    if (sectionMatches) {
      sectionMatches.forEach(section => {
        const titleMatch = section.match(/## (.*?)\n/);
        const contentMatch = section.replace(/## .*?\n/, '');
        
        if (titleMatch) {
          const title = titleMatch[1].trim();
          sections[title.toLowerCase().replace(/\s+/g, '_')] = {
            title: title,
            content: contentMatch.trim()
          };
        }
      });
    }
    
    return sections;
  }

  _generateStatistics(csvData) {
    const stats = {
      totalPages: csvData.length,
      statusCodes: {},
      avgWordCount: 0,
      pagesWithTitles: 0,
      pagesWithMetaDesc: 0,
      pagesWithH1: 0,
      indexablePages: 0
    };
    
    let totalWordCount = 0;
    
    csvData.forEach(row => {
      // Status codes
      const statusCode = row['Status Code'] || 'Unknown';
      stats.statusCodes[statusCode] = (stats.statusCodes[statusCode] || 0) + 1;
      
      // Word count
      const wordCount = parseInt(row['Word Count']) || 0;
      totalWordCount += wordCount;
      
      // Page elements
      if (row.Title) stats.pagesWithTitles++;
      if (row['Meta Description 1']) stats.pagesWithMetaDesc++;
      if (row['H1-1']) stats.pagesWithH1++;
      if (row.Indexability === 'Indexable') stats.indexablePages++;
    });
    
    stats.avgWordCount = Math.round(totalWordCount / csvData.length);
    
    return stats;
  }
}

module.exports = new AuditController();