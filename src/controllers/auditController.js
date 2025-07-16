// src/controllers/auditController.js - Enhanced with per-page analysis
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const auditService = require('../services/auditService');
const fileService = require('../services/fileService');
const reportService = require('../services/reportService');
const perPageReportService = require('../services/perPageReportService'); // New service
const path = require('path');
const config = require('../config');
const auditConfig = require('../config/audit');

class AuditController {
  async analyzeWebsite(slug) {
    const startTime = Date.now();
    logger.info(`Starting comprehensive SEO analysis for slug: ${slug}`);
    workflowLogger.info('Starting comprehensive SEO analysis', { slug });

    try {
      // Load CSV data
      const csvPath = path.join(config.paths.exportsDir, slug, auditConfig.files.csvFilename);
      workflowLogger.debug('Loading CSV file', { csvPath });
      
      const csvData = await fileService.readAndParseCSV(csvPath);
      workflowLogger.info('CSV data loaded', { 
        rowCount: csvData.length, 
        slug 
      });

      // Filter for actual pages (remove images, assets, etc.)
      const pageData = this._filterActualPages(csvData);
      workflowLogger.info('Filtered to actual pages', {
        originalCount: csvData.length,
        filteredCount: pageData.length,
        slug
      });

      // Perform chunked analysis for site overview
      workflowLogger.info('Starting chunked analysis for site overview', { slug });
      const siteAnalysis = await auditService.analyzeCSVData(pageData, slug);
      
      // NEW: Perform detailed per-page analysis
      workflowLogger.info('Starting detailed per-page analysis', { 
        slug,
        pageCount: pageData.length 
      });
      const perPageAnalysis = await auditService.analyzeIndividualPages(pageData, slug);

      // Generate comprehensive reports
      workflowLogger.info('Generating comprehensive reports', { slug });
      
      // 1. Site overview report (existing)
      const siteReportPath = await reportService.saveComprehensiveReport(slug, siteAnalysis);
      
      // 2. Per-page analysis reports (new)
      const perPageReports = await perPageReportService.generatePerPageReports(slug, perPageAnalysis, pageData);
      
      // 3. Executive summary report (new)
      const executiveSummary = await reportService.generateExecutiveSummary(slug, siteAnalysis, perPageAnalysis, pageData);

      // Prepare enhanced results for API response
      const comprehensiveResults = this._prepareEnhancedResults(
        siteAnalysis, 
        perPageAnalysis, 
        pageData, 
        slug,
        {
          siteReportPath,
          perPageReports,
          executiveSummary
        }
      );
      
      const duration = Date.now() - startTime;
      logger.info(`Comprehensive SEO analysis completed in ${duration}ms`);
      workflowLogger.info('Comprehensive SEO analysis completed', { 
        slug, 
        duration, 
        siteReportPath,
        perPageReportCount: perPageReports.length,
        summary: siteAnalysis.summary 
      });
      
      return {
        success: true,
        reportPath: siteReportPath,
        perPageReports: perPageReports,
        executiveSummary: executiveSummary,
        duration,
        slug,
        summary: siteAnalysis.summary,
        results: comprehensiveResults
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

  _filterActualPages(csvData) {
    return csvData.filter(row => {
      const url = row.Address || row.URL || '';
      const statusCode = row['Status Code'] || '';
      
      // Filter out non-page resources
      const excludePatterns = [
        /\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|doc|docx|xls|xlsx|zip|rar|mp3|mp4|avi|mov)$/i,
        /\/wp-content\/uploads\//i,
        /\/assets\//i,
        /\/images\//i,
        /\/media\//i,
        /\/static\//i,
        /\/files\//i,
        /\?.*\.(jpg|jpeg|png|gif|webp|svg|ico|css|js)$/i
      ];
      
      // Must be a successful page
      const isSuccessful = statusCode === '200' || statusCode === '';
      
      // Must not match exclusion patterns
      const isNotExcluded = !excludePatterns.some(pattern => pattern.test(url));
      
      // Must have meaningful content indicators
      const hasContent = row['Word Count'] && parseInt(row['Word Count']) > 50;
      
      return isSuccessful && isNotExcluded && hasContent;
    });
  }

  _prepareEnhancedResults(siteAnalysis, perPageAnalysis, pageData, slug, reports) {
    return {
      slug: slug,
      timestamp: new Date().toISOString(),
      summary: siteAnalysis.summary,
      
      // Enhanced overview with per-page insights
      overview: {
        totalPages: pageData.length,
        averageScore: siteAnalysis.summary.averageScore,
        analysisDate: siteAnalysis.summary.analyzedAt,
        topPerformingPages: this._getTopPerformingPages(perPageAnalysis, 5),
        worstPerformingPages: this._getWorstPerformingPages(perPageAnalysis, 5),
        commonIssues: this._identifyCommonIssues(perPageAnalysis),
        priorityActions: this._generatePriorityActions(perPageAnalysis)
      },
      
      // Individual page analyses with scores and recommendations
      pageAnalyses: perPageAnalysis.map(page => ({
        url: page.url,
        seoScore: page.seoScore,
        title: page.title || 'No title',
        metaDescription: page.metaDescription || 'Missing',
        issues: page.issues,
        recommendations: page.recommendations,
        priority: page.priority,
        estimatedImpact: page.estimatedImpact,
        quickWins: page.quickWins
      })),
      
      // Site-wide analysis
      siteAnalysis: {
        fullText: this._cleanAnalysisText(siteAnalysis.finalAnalysis),
        structured: this._structureSiteAnalysis(siteAnalysis.finalAnalysis)
      },
      
      // Technical SEO insights
      technicalInsights: this._generateTechnicalInsights(pageData),
      
      // Content analysis
      contentAnalysis: this._generateContentAnalysis(pageData),
      
      // Performance metrics
      performanceMetrics: this._generatePerformanceMetrics(pageData),
      
      // File paths for detailed reports
      reportFiles: {
        siteOverview: reports.siteReportPath,
        perPageReports: reports.perPageReports,
        executiveSummary: reports.executiveSummary.filePath
      },
      
      // Statistics for dashboard
      statistics: this._generateEnhancedStatistics(pageData, perPageAnalysis)
    };
  }

  _getTopPerformingPages(perPageAnalysis, count = 5) {
    return perPageAnalysis
      .filter(page => page.seoScore)
      .sort((a, b) => b.seoScore - a.seoScore)
      .slice(0, count)
      .map(page => ({
        url: page.url,
        score: page.seoScore,
        title: page.title
      }));
  }

  _getWorstPerformingPages(perPageAnalysis, count = 5) {
    return perPageAnalysis
      .filter(page => page.seoScore)
      .sort((a, b) => a.seoScore - b.seoScore)
      .slice(0, count)
      .map(page => ({
        url: page.url,
        score: page.seoScore,
        title: page.title,
        criticalIssues: page.issues?.slice(0, 3) || []
      }));
  }

  _identifyCommonIssues(perPageAnalysis) {
    const issueCount = {};
    
    perPageAnalysis.forEach(page => {
      if (page.issues) {
        page.issues.forEach(issue => {
          const normalizedIssue = issue.toLowerCase().trim();
          issueCount[normalizedIssue] = (issueCount[normalizedIssue] || 0) + 1;
        });
      }
    });
    
    return Object.entries(issueCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 10)
      .map(([issue, count]) => ({
        issue,
        affectedPages: count,
        percentage: Math.round((count / perPageAnalysis.length) * 100)
      }));
  }

  _generatePriorityActions(perPageAnalysis) {
    const actions = [];
    
    // Analyze common issues and generate priority actions
    const commonIssues = this._identifyCommonIssues(perPageAnalysis);
    
    commonIssues.slice(0, 5).forEach((issue, index) => {
      actions.push({
        priority: index + 1,
        action: this._getActionForIssue(issue.issue),
        impact: issue.percentage > 50 ? 'High' : issue.percentage > 25 ? 'Medium' : 'Low',
        effort: this._getEffortForIssue(issue.issue),
        affectedPages: issue.affectedPages
      });
    });
    
    return actions;
  }

  _getActionForIssue(issue) {
    const actionMap = {
      'missing meta description': 'Add compelling meta descriptions to all pages',
      'missing h1': 'Add H1 tags to all pages',
      'duplicate title': 'Create unique titles for each page',
      'thin content': 'Expand content with valuable information',
      'broken internal links': 'Fix all broken internal links',
      'missing alt text': 'Add descriptive alt text to all images',
      'slow loading': 'Optimize page loading speed',
      'missing structured data': 'Implement relevant schema markup'
    };
    
    return actionMap[issue] || `Address: ${issue}`;
  }

  _getEffortForIssue(issue) {
    const effortMap = {
      'missing meta description': 'Medium',
      'missing h1': 'Low',
      'duplicate title': 'Medium',
      'thin content': 'High',
      'broken internal links': 'Low',
      'missing alt text': 'Medium',
      'slow loading': 'High',
      'missing structured data': 'High'
    };
    
    return effortMap[issue] || 'Medium';
  }

  _generateTechnicalInsights(pageData) {
    const insights = {
      indexability: {},
      statusCodes: {},
      redirects: 0,
      httpsUsage: 0,
      canonicalIssues: 0
    };
    
    pageData.forEach(row => {
      // Indexability analysis
      const indexability = row.Indexability || 'Unknown';
      insights.indexability[indexability] = (insights.indexability[indexability] || 0) + 1;
      
      // Status codes
      const statusCode = row['Status Code'] || 'Unknown';
      insights.statusCodes[statusCode] = (insights.statusCodes[statusCode] || 0) + 1;
      
      // HTTPS usage
      const url = row.Address || row.URL || '';
      if (url.startsWith('https://')) {
        insights.httpsUsage++;
      }
      
      // Canonical issues (simplified check)
      const canonical = row['Canonical Link Element 1'] || '';
      if (canonical && canonical !== url) {
        insights.canonicalIssues++;
      }
    });
    
    return insights;
  }

  _generateContentAnalysis(pageData) {
    let totalWordCount = 0;
    let pagesWithTitles = 0;
    let pagesWithMetaDesc = 0;
    let pagesWithH1 = 0;
    let duplicateTitles = {};
    
    pageData.forEach(row => {
      const wordCount = parseInt(row['Word Count']) || 0;
      totalWordCount += wordCount;
      
      if (row.Title) {
        pagesWithTitles++;
        const title = row.Title.toLowerCase();
        duplicateTitles[title] = (duplicateTitles[title] || 0) + 1;
      }
      
      if (row['Meta Description 1']) pagesWithMetaDesc++;
      if (row['H1-1']) pagesWithH1++;
    });
    
    const duplicateCount = Object.values(duplicateTitles).filter(count => count > 1).length;
    
    return {
      averageWordCount: Math.round(totalWordCount / pageData.length),
      titleCoverage: Math.round((pagesWithTitles / pageData.length) * 100),
      metaDescriptionCoverage: Math.round((pagesWithMetaDesc / pageData.length) * 100),
      h1Coverage: Math.round((pagesWithH1 / pageData.length) * 100),
      duplicateTitles: duplicateCount,
      contentGaps: this._identifyContentGaps(pageData)
    };
  }

  _identifyContentGaps(pageData) {
    const gaps = [];
    
    const lowContentPages = pageData.filter(row => {
      const wordCount = parseInt(row['Word Count']) || 0;
      return wordCount < 300;
    }).length;
    
    if (lowContentPages > 0) {
      gaps.push({
        type: 'Thin Content',
        count: lowContentPages,
        description: 'Pages with less than 300 words'
      });
    }
    
    return gaps;
  }

  _generatePerformanceMetrics(pageData) {
    // This would be enhanced with actual performance data
    return {
      analyzedPages: pageData.length,
      crawlDate: new Date().toISOString(),
      estimatedCrawlTime: 'Based on site complexity'
    };
  }

  _generateEnhancedStatistics(pageData, perPageAnalysis) {
    const baseStats = this._generateStatistics(pageData);
    
    // Add per-page analysis statistics
    const scores = perPageAnalysis.map(page => page.seoScore).filter(score => score);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const highScorePages = scores.filter(score => score >= 80).length;
    const lowScorePages = scores.filter(score => score < 60).length;
    
    return {
      ...baseStats,
      seoScores: {
        average: Math.round(averageScore),
        highPerforming: highScorePages,
        needsImprovement: lowScorePages,
        distribution: this._getScoreDistribution(scores)
      },
      analysisDepth: {
        pagesAnalyzed: perPageAnalysis.length,
        issuesIdentified: perPageAnalysis.reduce((total, page) => total + (page.issues?.length || 0), 0),
        recommendationsGenerated: perPageAnalysis.reduce((total, page) => total + (page.recommendations?.length || 0), 0)
      }
    };
  }

  _getScoreDistribution(scores) {
    const distribution = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, '50-59': 0, '<50': 0 };
    
    scores.forEach(score => {
      if (score >= 90) distribution['90-100']++;
      else if (score >= 80) distribution['80-89']++;
      else if (score >= 70) distribution['70-79']++;
      else if (score >= 60) distribution['60-69']++;
      else if (score >= 50) distribution['50-59']++;
      else distribution['<50']++;
    });
    
    return distribution;
  }

  // Existing methods (keep unchanged)
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

  _structureSiteAnalysis(fullAnalysis) {
    const sections = {};
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
    // Existing implementation
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
      const statusCode = row['Status Code'] || 'Unknown';
      stats.statusCodes[statusCode] = (stats.statusCodes[statusCode] || 0) + 1;
      
      const wordCount = parseInt(row['Word Count']) || 0;
      totalWordCount += wordCount;
      
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