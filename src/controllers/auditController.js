// src/controllers/auditController.js
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
        summary: analysis.summary
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
}

module.exports = new AuditController();