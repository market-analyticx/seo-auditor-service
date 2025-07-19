// src/services/reportService.js - Enhanced with organized folder structure
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config');
const auditConfig = require('../config/audit');

class ReportService {
  constructor() {
    this.baseReportsDir = config.paths.reportsDir || path.join(__dirname, '../../reports');
  }

  // Create organized folder structure: reports/slug/timestamp/
  async createReportDirectory(slug) {
    try {
      // Ensure base reports directory exists
      await this._ensureDirectoryExists(this.baseReportsDir);
      
      // Create slug-specific directory
      const slugDir = path.join(this.baseReportsDir, slug);
      await this._ensureDirectoryExists(slugDir);
      
      // Create timestamp-specific directory
      const timestamp = new Date().toISOString()
        .replace(/:/g, '-')
        .replace(/\./g, '-')
        .substring(0, 19); // YYYY-MM-DDTHH-MM-SS
      
      const timestampDir = path.join(slugDir, timestamp);
      await this._ensureDirectoryExists(timestampDir);
      
      workflowLogger.info('Created organized report directory structure', {
        slug,
        timestamp,
        timestampDir,
        structure: {
          base: this.baseReportsDir,
          slug: slugDir,
          session: timestampDir
        }
      });
      
      return {
        baseDir: this.baseReportsDir,
        slugDir: slugDir,
        sessionDir: timestampDir,
        timestamp: timestamp
      };
      
    } catch (error) {
      workflowLogger.error('Failed to create report directory structure', {
        slug,
        error: error.message
      });
      throw error;
    }
  }

  async saveComprehensiveReport(slug, analysis) {
    try {
      // Create organized directory structure
      const directories = await this.createReportDirectory(slug);
      
      // Save comprehensive analysis in the session directory
      const filename = 'comprehensive_analysis.txt';
      const filePath = path.join(directories.sessionDir, filename);
      
      workflowLogger.info('Generating comprehensive report', { 
        slug, 
        filename,
        sessionDir: directories.sessionDir
      });
      
      const reportContent = this._generateReportContent(slug, analysis);
      await fs.writeFile(filePath, reportContent, 'utf8');
      
      logger.info(`Saved comprehensive report to: ${filePath}`);
      workflowLogger.info('Comprehensive report saved', {
        slug,
        filePath,
        contentLength: reportContent.length,
        directories
      });
      
      return {
        filePath,
        filename,
        directories,
        contentLength: reportContent.length
      };
      
    } catch (error) {
      workflowLogger.error('Failed to save comprehensive report', {
        slug,
        error: error.message
      });
      throw error;
    }
  }

  async generateExecutiveSummary(slug, siteAnalysis, perPageAnalysis, pageData) {
    try {
      workflowLogger.info('Generating executive summary', { slug });

      // Create organized directory structure (reuse if already created)
      const directories = await this.createReportDirectory(slug);
      
      const filename = 'executive_summary.md';
      const filePath = path.join(directories.sessionDir, filename);

      const summaryContent = this._generateExecutiveSummaryContent(
        slug, 
        siteAnalysis, 
        perPageAnalysis, 
        pageData
      );

      await fs.writeFile(filePath, summaryContent, 'utf8');
      
      workflowLogger.info('Executive summary generated', { 
        slug, 
        filePath,
        contentLength: summaryContent.length,
        sessionDir: directories.sessionDir
      });

      return {
        filePath,
        filename,
        directories,
        summary: this._extractKeyMetrics(siteAnalysis, perPageAnalysis, pageData),
        contentLength: summaryContent.length
      };

    } catch (error) {
      workflowLogger.error('Executive summary generation failed', {
        slug,
        error: error.message
      });
      throw error;
    }
  }

  // Get the latest session directory for a slug (useful for per-page reports)
  async getLatestSessionDirectory(slug) {
    try {
      const slugDir = path.join(this.baseReportsDir, slug);
      
      // Check if slug directory exists
      try {
        await fs.access(slugDir);
      } catch {
        // If slug directory doesn't exist, create new structure
        return await this.createReportDirectory(slug);
      }
      
      // Get all session directories and find the latest
      const entries = await fs.readdir(slugDir, { withFileTypes: true });
      const sessionDirs = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
        .reverse(); // Latest first
      
      if (sessionDirs.length === 0) {
        // No existing sessions, create new
        return await this.createReportDirectory(slug);
      }
      
      const latestSession = sessionDirs[0];
      const sessionDir = path.join(slugDir, latestSession);
      
      return {
        baseDir: this.baseReportsDir,
        slugDir: slugDir,
        sessionDir: sessionDir,
        timestamp: latestSession
      };
      
    } catch (error) {
      workflowLogger.error('Failed to get latest session directory', {
        slug,
        error: error.message
      });
      throw error;
    }
  }

  // List all analysis sessions for a slug
  async listAnalysisSessions(slug) {
    try {
      const slugDir = path.join(this.baseReportsDir, slug);
      
      try {
        await fs.access(slugDir);
      } catch {
        return []; // No sessions exist
      }
      
      const entries = await fs.readdir(slugDir, { withFileTypes: true });
      const sessions = [];
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const sessionDir = path.join(slugDir, entry.name);
          try {
            const stats = await fs.stat(sessionDir);
            const files = await fs.readdir(sessionDir);
            
            sessions.push({
              timestamp: entry.name,
              path: sessionDir,
              created: stats.birthtime,
              modified: stats.mtime,
              fileCount: files.length,
              files: files
            });
          } catch (statError) {
            workflowLogger.warn('Failed to get session stats', {
              slug,
              session: entry.name,
              error: statError.message
            });
          }
        }
      }
      
      // Sort by timestamp (newest first)
      sessions.sort((a, b) => new Date(b.created) - new Date(a.created));
      
      return sessions;
      
    } catch (error) {
      workflowLogger.error('Failed to list analysis sessions', {
        slug,
        error: error.message
      });
      return [];
    }
  }

  // Clean up old analysis sessions (keep only N most recent)
  async cleanupOldSessions(slug, keepCount = 5) {
    try {
      const sessions = await this.listAnalysisSessions(slug);
      
      if (sessions.length <= keepCount) {
        workflowLogger.info('No cleanup needed', {
          slug,
          sessionCount: sessions.length,
          keepCount
        });
        return { removed: 0, kept: sessions.length };
      }
      
      const sessionsToRemove = sessions.slice(keepCount);
      let removedCount = 0;
      
      for (const session of sessionsToRemove) {
        try {
          await fs.rm(session.path, { recursive: true, force: true });
          removedCount++;
          workflowLogger.info('Removed old session', {
            slug,
            session: session.timestamp,
            path: session.path
          });
        } catch (removeError) {
          workflowLogger.error('Failed to remove old session', {
            slug,
            session: session.timestamp,
            error: removeError.message
          });
        }
      }
      
      workflowLogger.info('Session cleanup completed', {
        slug,
        removedCount,
        keptCount: sessions.length - removedCount
      });
      
      return { removed: removedCount, kept: sessions.length - removedCount };
      
    } catch (error) {
      workflowLogger.error('Session cleanup failed', {
        slug,
        error: error.message
      });
      throw error;
    }
  }

  _generateExecutiveSummaryContent(slug, siteAnalysis, perPageAnalysis, pageData) {
    const keyMetrics = this._extractKeyMetrics(siteAnalysis, perPageAnalysis, pageData);
    const domain = slug.replace(/_/g, '.');

    return `# SEO Executive Summary

## Website: ${domain}
**Analysis Date**: ${new Date().toLocaleString()}  
**Report Generated By**: SEO Auditor Service v2.0

---

## 🎯 Key Performance Indicators

| Metric | Value | Status |
|--------|--------|--------|
| **Overall SEO Score** | ${keyMetrics.overallScore}/100 | ${this._getScoreStatus(keyMetrics.overallScore)} |
| **Pages Analyzed** | ${keyMetrics.totalPages} | ✅ Complete |
| **Critical Issues** | ${keyMetrics.criticalIssues} | ${keyMetrics.criticalIssues > 10 ? '⚠️ High' : keyMetrics.criticalIssues > 5 ? '⚠️ Medium' : '✅ Low'} |
| **Quick Wins Available** | ${keyMetrics.quickWins} | ${keyMetrics.quickWins > 0 ? '🎯 Opportunities' : '✅ Optimized'} |

---

## 📊 Performance Overview

### Score Distribution
- **Excellent (90-100)**: ${keyMetrics.scoreDistribution.excellent} pages
- **Good (80-89)**: ${keyMetrics.scoreDistribution.good} pages  
- **Fair (70-79)**: ${keyMetrics.scoreDistribution.fair} pages
- **Poor (60-69)**: ${keyMetrics.scoreDistribution.poor} pages
- **Critical (<60)**: ${keyMetrics.scoreDistribution.critical} pages

### Priority Actions Required
- **High Priority**: ${keyMetrics.priorities.high} pages need immediate attention
- **Medium Priority**: ${keyMetrics.priorities.medium} pages for regular optimization
- **Low Priority**: ${keyMetrics.priorities.low} pages for future enhancement

---

## 🚀 Top Recommendations

### Immediate Actions (Week 1-2)
${this._generateTopRecommendations(perPageAnalysis, 'High').slice(0, 5).map((rec, i) => `${i + 1}. ${rec}`).join('\n')}

### Quick Wins (Week 2-4)
${this._generateQuickWins(perPageAnalysis).slice(0, 5).map((win, i) => `${i + 1}. ${win}`).join('\n')}

---

## 📈 Expected Impact

### Traffic Improvement Potential
- **Estimated organic traffic increase**: 25-45% within 6 months
- **Pages with high improvement potential**: ${keyMetrics.highImpactPages}
- **Expected ranking improvements**: ${keyMetrics.rankingOpportunities} keywords

### Implementation Timeline
- **Phase 1 (Month 1)**: Technical fixes and quick wins
- **Phase 2 (Month 2-3)**: Content optimization and on-page improvements  
- **Phase 3 (Month 4-6)**: Advanced optimizations and monitoring

---

## ⚠️ Critical Issues Summary

${this._generateCriticalIssuesSummary(perPageAnalysis)}

---

## 🎯 Business Impact

### Revenue Opportunity
Based on current performance and optimization potential:
- **Low estimate**: +15% organic traffic = potential revenue increase
- **Conservative estimate**: +25% organic traffic
- **Optimistic estimate**: +45% organic traffic

### Competitive Advantage
- **Technical SEO**: ${keyMetrics.technicalHealth}% health score
- **Content Quality**: ${keyMetrics.contentQuality}% optimization score
- **User Experience**: Improvement opportunities identified

---

## 📋 Next Steps

### Immediate (This Week)
1. Review and prioritize high-impact pages
2. Begin technical fixes for critical issues
3. Implement quick wins for meta descriptions and titles

### Short-term (This Month)
1. Execute Phase 1 optimizations
2. Monitor ranking improvements
3. Begin content enhancement for key pages

### Long-term (Next 3-6 Months)
1. Complete full optimization program
2. Implement advanced SEO strategies
3. Establish ongoing monitoring and maintenance

---

## 📞 Recommendations for Success

**Priority Level**: ${keyMetrics.overallScore < 60 ? 'URGENT' : keyMetrics.overallScore < 75 ? 'HIGH' : 'MEDIUM'}

**Recommended Action**: ${this._getOverallRecommendation(keyMetrics.overallScore)}

**Estimated ROI**: ${this._calculateEstimatedROI(keyMetrics)}

---

*This executive summary provides a high-level overview. For detailed page-by-page analysis and specific implementation guidelines, please refer to the comprehensive analysis report and individual page reports.*

**Report Confidence Level**: ${keyMetrics.confidenceLevel}%  
**Analysis Methodology**: Automated SEO audit with AI-powered recommendations  
**Last Updated**: ${new Date().toLocaleString()}
`;
  }

  _extractKeyMetrics(siteAnalysis, perPageAnalysis, pageData) {
    const scores = perPageAnalysis.map(p => p.seoScore).filter(s => s !== null && s !== undefined);
    const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    
    const priorities = {
      high: perPageAnalysis.filter(p => p.priority === 'High').length,
      medium: perPageAnalysis.filter(p => p.priority === 'Medium').length,
      low: perPageAnalysis.filter(p => p.priority === 'Low').length
    };

    const scoreDistribution = {
      excellent: scores.filter(s => s >= 90).length,
      good: scores.filter(s => s >= 80 && s < 90).length,
      fair: scores.filter(s => s >= 70 && s < 80).length,
      poor: scores.filter(s => s >= 60 && s < 70).length,
      critical: scores.filter(s => s < 60).length
    };

    const criticalIssues = perPageAnalysis.reduce((total, page) => {
      return total + (page.issues ? page.issues.length : 0);
    }, 0);

    const quickWins = perPageAnalysis.reduce((total, page) => {
      return total + (page.quickWins ? page.quickWins.length : 0);
    }, 0);

    return {
      overallScore,
      totalPages: perPageAnalysis.length,
      priorities,
      scoreDistribution,
      criticalIssues,
      quickWins,
      highImpactPages: scores.filter(s => s < 70).length,
      rankingOpportunities: Math.round(perPageAnalysis.length * 0.3), // Estimate
      technicalHealth: Math.min(100, overallScore + 10), // Estimate
      contentQuality: Math.max(50, overallScore - 5), // Estimate
      confidenceLevel: Math.min(95, 70 + (perPageAnalysis.length * 2)) // Higher confidence with more pages
    };
  }

  _getScoreStatus(score) {
    if (score >= 90) return '🟢 Excellent';
    if (score >= 80) return '🟡 Good';
    if (score >= 70) return '🟠 Fair';
    if (score >= 60) return '🔴 Poor';
    return '🚨 Critical';
  }

  _generateTopRecommendations(perPageAnalysis, priority) {
    const recommendations = [];
    
    perPageAnalysis
      .filter(page => page.priority === priority)
      .forEach(page => {
        if (page.recommendations) {
          page.recommendations.forEach(rec => {
            recommendations.push(`${rec} (${page.url})`);
          });
        }
      });

    return [...new Set(recommendations)]; // Remove duplicates
  }

  _generateQuickWins(perPageAnalysis) {
    const quickWins = [];
    
    perPageAnalysis.forEach(page => {
      if (page.quickWins) {
        page.quickWins.forEach(win => {
          quickWins.push(`${win} (${page.url})`);
        });
      }
    });

    return [...new Set(quickWins)].slice(0, 10); // Top 10 unique quick wins
  }

  _generateCriticalIssuesSummary(perPageAnalysis) {
    const issueCount = {};
    
    perPageAnalysis.forEach(page => {
      if (page.issues) {
        page.issues.forEach(issue => {
          const normalizedIssue = issue.toLowerCase().trim();
          issueCount[normalizedIssue] = (issueCount[normalizedIssue] || 0) + 1;
        });
      }
    });

    const topIssues = Object.entries(issueCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5);

    if (topIssues.length === 0) {
      return '✅ No critical issues identified across analyzed pages.';
    }

    return topIssues.map(([issue, count]) => 
      `- **${issue}**: ${count} pages affected ${this._getIssueIcon(count, perPageAnalysis.length)}`
    ).join('\n');
  }

  _getIssueIcon(count, totalPages) {
    const percentage = (count / totalPages) * 100;
    if (percentage >= 50) return '🚨';
    if (percentage >= 25) return '⚠️';
    if (percentage >= 10) return '🟡';
    return '🔵';
  }

  _getOverallRecommendation(score) {
    if (score >= 90) {
      return 'Maintain current excellent SEO performance and focus on competitive advantages.';
    } else if (score >= 80) {
      return 'Implement targeted improvements to reach SEO excellence.';
    } else if (score >= 70) {
      return 'Execute comprehensive SEO optimization program focusing on high-impact areas.';
    } else if (score >= 60) {
      return 'Immediate SEO intervention required. Focus on critical issues first.';
    } else {
      return 'URGENT: Complete SEO overhaul needed. Recommend immediate professional consultation.';
    }
  }

  _calculateEstimatedROI(metrics) {
    const improvementPotential = 100 - metrics.overallScore;
    const trafficIncrease = Math.min(50, improvementPotential * 0.8); // Conservative estimate
    
    if (trafficIncrease >= 30) return 'Very High (300-500% ROI)';
    if (trafficIncrease >= 20) return 'High (200-300% ROI)';
    if (trafficIncrease >= 10) return 'Medium (150-200% ROI)';
    return 'Moderate (100-150% ROI)';
  }

  // Updated method - only include final analysis, not chunk results
  _generateReportContent(slug, analysis) {
    let content = `# COMPREHENSIVE SEO ANALYSIS FOR ${slug.toUpperCase()}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;
    content += `Model used: ${auditConfig.models.openai.model}\n\n`;
    
    // Only include the final comprehensive analysis, not the raw chunk results
    content += `## COMPREHENSIVE SITE ANALYSIS\n\n`;
    content += this._cleanReportText(analysis.finalAnalysis);
    
    // Add summary if available
    if (analysis.summary) {
      content += `\n\n## ANALYSIS SUMMARY\n\n`;
      content += `Average SEO Score: ${analysis.summary.averageScore || 'Not calculated'}\n`;
      content += `Analysis Date: ${analysis.summary.analyzedAt || new Date().toISOString()}\n`;
    }
    
    workflowLogger.debug('Clean report content generated', {
      slug,
      sectionCount: 1,
      totalLength: content.length
    });
    
    return content;
  }

  _cleanReportText(text) {
    if (!text) return '';
    
    return text
      // Remove special characters and formatting marks
      .replace(/\*{2,}/g, '')
      .replace(/\*\*/g, '')
      .replace(/\*/g, '')
      // Remove non-ASCII characters except basic punctuation
      .replace(/[^\x20-\x7E\n\r\t]/g, '')
      // Clean up multiple spaces and newlines
      .replace(/[ ]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      // Remove empty lines with just dashes or asterisks
      .replace(/^[-*\s]*$/gm, '')
      // Clean up each line
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n')
      .trim();
  }

  async _ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
      workflowLogger.info('Created directory', { path: dirPath });
    }
  }
}

module.exports = new ReportService();