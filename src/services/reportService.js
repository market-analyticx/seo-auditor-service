// src/services/reportService.js
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config');
const auditConfig = require('../config/audit');

class ReportService {
  async saveComprehensiveReport(slug, analysis) {
    const reportsDir = config.paths.reportsDir || path.join(__dirname, '../../reports');
    await this._ensureDirectoryExists(reportsDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${slug}_comprehensive_seo_analysis_${timestamp}.txt`;
    const filePath = path.join(reportsDir, filename);
    
    workflowLogger.info('Generating report content', { slug, filename });
    const reportContent = this._generateReportContent(slug, analysis);
    
    workflowLogger.debug('Writing report file', { 
      filePath, 
      contentLength: reportContent.length 
    });
    await fs.writeFile(filePath, reportContent, 'utf8');
    logger.info(`Saved comprehensive report to: ${filePath}`);
    workflowLogger.info('Report saved successfully', { 
      slug, 
      filePath,
      fileSize: reportContent.length 
    });
    
    return filePath;
  }

  _generateReportContent(slug, analysis) {
    let content = `# COMPREHENSIVE SEO ANALYSIS FOR ${slug.toUpperCase()}\n`;
    content += `Generated on: ${new Date().toLocaleString()}\n`;
    content += `Model used: ${auditConfig.models.openai.model}\n\n`;
    
    content += `## PAGE-BY-PAGE ANALYSIS\n\n`;
    analysis.chunkResults.forEach((result, index) => {
      content += result + '\n';
    });
    
    content += `## COMPREHENSIVE SITE ANALYSIS\n\n`;
    content += analysis.finalAnalysis;
    
    workflowLogger.debug('Report content generated', {
      slug,
      sectionCount: 2,
      totalLength: content.length
    });
    
    return content;
  }

  async _ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
      workflowLogger.info('Created reports directory', { path: dirPath });
    }
  }
}

module.exports = new ReportService();