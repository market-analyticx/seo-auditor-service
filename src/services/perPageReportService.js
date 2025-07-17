// src/services/perPageReportService.js - Generate detailed per-page reports
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config');

class PerPageReportService {
  constructor() {
    this.reportsDir = config.paths.reportsDir || path.join(__dirname, '../../reports');
  }

  async generatePerPageReports(slug, perPageAnalysis, pageData) {
    try {
      workflowLogger.info('Starting per-page report generation', {
        slug,
        pageCount: perPageAnalysis.length
      });

      await this._ensureDirectoryExists(this.reportsDir);
      
      // Create a subdirectory for this analysis
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const analysisDir = path.join(this.reportsDir, `${slug}_per_page_${timestamp}`);
      await this._ensureDirectoryExists(analysisDir);

      const reports = [];

      // Generate individual page reports
      for (let i = 0; i < perPageAnalysis.length; i++) {
        const pageAnalysis = perPageAnalysis[i];
        const originalData = pageData[i];
        
        try {
          const reportPath = await this._generateIndividualPageReport(
            pageAnalysis, 
            originalData, 
            analysisDir, 
            i + 1
          );
          
          reports.push({
            url: pageAnalysis.url,
            reportPath,
            seoScore: pageAnalysis.seoScore,
            priority: pageAnalysis.priority
          });
          
        } catch (pageError) {
          workflowLogger.warn('Failed to generate individual page report', {
            url: pageAnalysis.url,
            error: pageError.message
          });
        }
      }

      // Generate summary report
      const summaryReportPath = await this._generateSummaryReport(
        perPageAnalysis, 
        analysisDir, 
        slug
      );

      // Generate priority action report
      const actionReportPath = await this._generateActionReport(
        perPageAnalysis,
        analysisDir,
        slug
      );

      workflowLogger.info('Per-page reports generated successfully', {
        slug,
        individualReports: reports.length,
        summaryReport: summaryReportPath,
        actionReport: actionReportPath
      });

      return {
        analysisDirectory: analysisDir,
        individualReports: reports,
        summaryReport: summaryReportPath,
        actionReport: actionReportPath,
        totalReports: reports.length
      };

    } catch (error) {
      workflowLogger.error('Per-page report generation failed', {
        slug,
        error: error.message
      });
      throw error;
    }
  }

  async _generateIndividualPageReport(pageAnalysis, originalData, analysisDir, pageNumber) {
    const urlSlug = this._createUrlSlug(pageAnalysis.url);
    const filename = `page_${pageNumber.toString().padStart(3, '0')}_${urlSlug}.md`;
    const filePath = path.join(analysisDir, filename);

    const reportContent = this._createPageReportContent(pageAnalysis, originalData, pageNumber);
    
    await fs.writeFile(filePath, reportContent, 'utf8');
    
    return filePath;
  }

  _createPageReportContent(pageAnalysis, originalData, pageNumber) {
    // Clean and format all data to remove special characters
    const cleanUrl = this._cleanText(pageAnalysis.url || 'Unknown');
    const cleanTitle = this._cleanText(pageAnalysis.title || 'No title');
    const cleanMetaDesc = this._cleanText(pageAnalysis.metaDescription || 'Missing');
    const seoScore = pageAnalysis.seoScore || 'Not available';
    const priority = this._cleanText(pageAnalysis.priority || 'Medium');
    const impact = this._cleanText(pageAnalysis.estimatedImpact || 'Unknown');

    const content = `# SEO Analysis Report - Page ${pageNumber}

## Page Overview
- URL: ${cleanUrl}
- Title: ${cleanTitle}
- SEO Score: ${seoScore}/100
- Priority: ${priority}
- Estimated Impact: ${impact}

## Technical Details
- Status Code: ${originalData['Status Code'] || 'Unknown'}
- Indexability: ${originalData.Indexability || 'Unknown'}
- Word Count: ${originalData['Word Count'] || '0'}
- Internal Links: ${originalData.Inlinks || '0'}
- External Links: ${originalData.Outlinks || '0'}
- Last Modified: ${originalData['Last Modified'] || 'Unknown'}

## Meta Information
- Meta Description: ${cleanMetaDesc}
- Meta Description Length: ${cleanMetaDesc.length} characters
- H1 Tag: ${this._cleanText(originalData['H1-1'] || 'Missing')}
- H2 Tag: ${this._cleanText(originalData['H1-2'] || 'None')}
- Canonical URL: ${this._cleanText(originalData['Canonical Link Element 1'] || 'None')}

## Critical Issues Found
${this._formatCleanList(pageAnalysis.issues, 'No critical issues identified.')}

## Quick Wins (Easy Fixes)
${this._formatCleanList(pageAnalysis.quickWins, 'No quick wins identified.')}

## Detailed Recommendations
${this._formatCleanList(pageAnalysis.recommendations, 'No specific recommendations available.')}

## SEO Score Breakdown
${this._generateScoreBreakdown(pageAnalysis.seoScore)}

## Action Priority
Priority Level: ${priority}

${this._getPriorityExplanation(pageAnalysis.priority, pageAnalysis.seoScore)}

---
Report generated on ${new Date().toLocaleString()}
Analysis by SEO Auditor Service v2.0
`;

    return content;
  }

  _cleanText(text) {
    if (!text) return '';
    
    return String(text)
      // Remove special characters and formatting
      .replace(/\*{2,}/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      .replace(/[^\x20-\x7E]/g, '')
      // Clean up extra spaces
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  _formatCleanList(items, defaultText) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return defaultText;
    }

    return items
      .map(item => this._cleanText(item))
      .filter(item => item.length > 0)
      .map((item, index) => `${index + 1}. ${item}`)
      .join('\n');
  }

  _generateScoreBreakdown(score) {
    if (!score) return 'Score breakdown not available.';
    
    let breakdown = '';
    if (score >= 90) {
      breakdown = 'Excellent! This page is performing very well and requires minimal optimization.';
    } else if (score >= 80) {
      breakdown = 'Good performance with room for minor improvements.';
    } else if (score >= 70) {
      breakdown = 'Decent performance but several optimization opportunities exist.';
    } else if (score >= 60) {
      breakdown = 'Below average performance. Significant improvements needed.';
    } else {
      breakdown = 'Poor performance. This page requires immediate attention and comprehensive optimization.';
    }
    
    return breakdown;
  }

  _getPriorityExplanation(priority, score) {
    const explanations = {
      'High': 'This page should be optimized immediately. It likely has high traffic potential or represents important content for your business.',
      'Medium': 'This page should be optimized as part of your regular SEO maintenance cycle.',
      'Low': 'This page can be optimized when time and resources permit, after higher priority pages are addressed.'
    };
    
    return explanations[priority] || explanations['Medium'];
  }

  async _generateSummaryReport(perPageAnalysis, analysisDir, slug) {
    const filename = 'per_page_analysis_summary.md';
    const filePath = path.join(analysisDir, filename);

    const scores = perPageAnalysis.map(p => p.seoScore).filter(s => s);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    
    const highPriority = perPageAnalysis.filter(p => p.priority === 'High');
    const mediumPriority = perPageAnalysis.filter(p => p.priority === 'Medium');
    const lowPriority = perPageAnalysis.filter(p => p.priority === 'Low');

    const topPages = perPageAnalysis
      .filter(p => p.seoScore)
      .sort((a, b) => b.seoScore - a.seoScore)
      .slice(0, 5);

    const worstPages = perPageAnalysis
      .filter(p => p.seoScore)
      .sort((a, b) => a.seoScore - b.seoScore)
      .slice(0, 5);

    const content = `# Per-Page SEO Analysis Summary

## Overview
- **Website**: ${slug}
- **Total Pages Analyzed**: ${perPageAnalysis.length}
- **Average SEO Score**: ${Math.round(averageScore)}/100
- **Analysis Date**: ${new Date().toLocaleString()}

## Priority Distribution
- **High Priority Pages**: ${highPriority.length}
- **Medium Priority Pages**: ${mediumPriority.length}
- **Low Priority Pages**: ${lowPriority.length}

## Score Distribution
- **90-100 (Excellent)**: ${scores.filter(s => s >= 90).length} pages
- **80-89 (Good)**: ${scores.filter(s => s >= 80 && s < 90).length} pages
- **70-79 (Fair)**: ${scores.filter(s => s >= 70 && s < 80).length} pages
- **60-69 (Poor)**: ${scores.filter(s => s >= 60 && s < 70).length} pages
- **Below 60 (Critical)**: ${scores.filter(s => s < 60).length} pages

## Top Performing Pages
${topPages.map((page, index) => 
  `${index + 1}. **${page.seoScore}/100** - ${page.url}`
).join('\n')}

## Pages Needing Immediate Attention
${worstPages.map((page, index) => 
  `${index + 1}. **${page.seoScore}/100** - ${page.url}`
).join('\n')}

## Most Common Issues
${this._getMostCommonIssues(perPageAnalysis)}

## Recommended Action Plan
${this._generateActionPlan(highPriority, mediumPriority, lowPriority)}

---
*For detailed analysis of each page, see individual page reports in this directory.*
`;

    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  _getMostCommonIssues(perPageAnalysis) {
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
      .slice(0, 5)
      .map(([issue, count]) => `- **${issue}**: ${count} pages affected`)
      .join('\n');
  }

  _generateActionPlan(highPriority, mediumPriority, lowPriority) {
    return `
### Phase 1 (Immediate - Week 1-2)
Focus on ${highPriority.length} high-priority pages:
${highPriority.slice(0, 5).map(page => `- ${page.url} (Score: ${page.seoScore})`).join('\n')}

### Phase 2 (Short-term - Week 3-6)
Address ${mediumPriority.length} medium-priority pages:
${mediumPriority.slice(0, 5).map(page => `- ${page.url} (Score: ${page.seoScore})`).join('\n')}
${mediumPriority.length > 5 ? `- ... and ${mediumPriority.length - 5} more pages` : ''}

### Phase 3 (Long-term - Month 2+)
Optimize ${lowPriority.length} low-priority pages:
${lowPriority.slice(0, 3).map(page => `- ${page.url} (Score: ${page.seoScore})`).join('\n')}
${lowPriority.length > 3 ? `- ... and ${lowPriority.length - 3} more pages` : ''}
`;
  }

  async _generateActionReport(perPageAnalysis, analysisDir, slug) {
    const filename = 'priority_action_plan.md';
    const filePath = path.join(analysisDir, filename);

    // Group actions by type and priority
    const actionsByType = this._groupActionsByType(perPageAnalysis);
    
    const content = `# Priority Action Plan

## Executive Summary
This document outlines the specific actions needed to improve the SEO performance of ${slug}.

## Quick Wins (High Impact, Low Effort)
${this._formatActionGroup(actionsByType.quickWins)}

## Technical Fixes (Medium Effort)
${this._formatActionGroup(actionsByType.technical)}

## Content Optimization (High Effort)
${this._formatActionGroup(actionsByType.content)}

## Estimated Timeline
- **Quick Wins**: 1-2 weeks
- **Technical Fixes**: 3-4 weeks  
- **Content Optimization**: 2-3 months

## Expected Results
By implementing these recommendations:
- Estimated SEO score improvement: +15-25 points average
- Expected organic traffic increase: 20-40%
- Time to see results: 3-6 months

---
*Report generated on ${new Date().toLocaleString()}*
`;

    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  _groupActionsByType(perPageAnalysis) {
    const actions = {
      quickWins: [],
      technical: [],
      content: []
    };

    perPageAnalysis.forEach(page => {
      if (page.quickWins) {
        page.quickWins.forEach(win => {
          actions.quickWins.push({ action: win, url: page.url, score: page.seoScore });
        });
      }

      if (page.issues) {
        page.issues.forEach(issue => {
          if (this._isTechnicalIssue(issue)) {
            actions.technical.push({ action: issue, url: page.url, score: page.seoScore });
          } else {
            actions.content.push({ action: issue, url: page.url, score: page.seoScore });
          }
        });
      }
    });

    return actions;
  }

  _isTechnicalIssue(issue) {
    const technicalKeywords = [
      'meta', 'title', 'canonical', 'redirect', 'status', 'indexable', 
      'robots', 'sitemap', 'schema', 'structured data', 'alt text'
    ];
    
    return technicalKeywords.some(keyword => 
      issue.toLowerCase().includes(keyword)
    );
  }

  _formatActionGroup(actionGroup) {
    if (actionGroup.length === 0) {
      return 'No specific actions identified in this category.';
    }

    // Group similar actions
    const groupedActions = {};
    actionGroup.forEach(item => {
      const key = item.action.toLowerCase();
      if (!groupedActions[key]) {
        groupedActions[key] = { action: item.action, urls: [], count: 0 };
      }
      groupedActions[key].urls.push(item.url);
      groupedActions[key].count++;
    });

    return Object.values(groupedActions)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10) // Top 10 actions
      .map(group => 
        `- **${group.action}** (${group.count} pages affected)\n  ${group.urls.slice(0, 3).map(url => `  - ${url}`).join('\n')}${group.urls.length > 3 ? `\n  - ... and ${group.urls.length - 3} more` : ''}`
      )
      .join('\n\n');
  }

  _createUrlSlug(url) {
    return url
      .replace(/https?:\/\//, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase()
      .substring(0, 50); // Limit length for filename
  }

  async _ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
    }
  }
}

module.exports = new PerPageReportService();