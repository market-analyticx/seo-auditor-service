// src/services/fileService.js
const fs = require('fs').promises;
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const { parse } = require('csv-parse/sync');

class FileService {
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
      logger.info(`Created directory: ${dirPath}`);
      workflowLogger.info('Directory created', { path: dirPath });
    }
  }

  async removeDirectory(dirPath) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true });
      logger.info(`Removed directory: ${dirPath}`);
      workflowLogger.info('Directory removed', { path: dirPath });
    } catch (error) {
      logger.warn(`Failed to remove directory ${dirPath}: ${error.message}`);
      workflowLogger.warn('Directory removal failed', { 
        path: dirPath, 
        error: error.message 
      });
    }
  }

  async readFile(filePath) {
    try {
      workflowLogger.debug('Reading file', { filePath });
      const content = await fs.readFile(filePath, 'utf8');
      workflowLogger.info('File read successfully', { 
        filePath, 
        size: content.length 
      });
      return content;
    } catch (error) {
      logger.error(`Failed to read file ${filePath}: ${error.message}`);
      workflowLogger.error('File read failed', { 
        filePath, 
        error: error.message 
      });
      throw error;
    }
  }

  async readAndParseCSV(filePath) {
    try {
      workflowLogger.info('Reading and parsing CSV', { filePath });
      let raw = await fs.readFile(filePath, 'utf8');
      raw = raw.replace(/^\uFEFF/, ''); // Remove BOM
      
      const rows = parse(raw, {
        columns: true,
        skip_empty_lines: true,
      });
      
      logger.info(`Parsed ${rows.length} rows from CSV`);
      workflowLogger.info('CSV parsed successfully', { 
        filePath, 
        rowCount: rows.length,
        columnCount: rows.length > 0 ? Object.keys(rows[0]).length : 0
      });
      
      return rows;
    } catch (error) {
      logger.error(`Failed to read/parse CSV ${filePath}: ${error.message}`);
      workflowLogger.error('CSV parsing failed', { 
        filePath, 
        error: error.message,
        errorType: error.constructor.name 
      });
      throw error;
    }
  }
}

module.exports = new FileService();