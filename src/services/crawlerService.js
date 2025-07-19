// src/services/crawlerService.js - Performance optimized version
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config');
const path = require('path');

const execAsync = promisify(exec);

class CrawlerService {
  async execute(url, outputDir, retries = config.retries.maxAttempts) {
    const command = this._buildOptimizedCommand(url, outputDir);

    for (let attempt = 1; attempt <= retries; attempt++) {
      const startTime = Date.now();
      
      try {
        logger.info(`Executing fast crawl (attempt ${attempt}/${retries}): ${url}`);
        workflowLogger.info('Starting fast crawl attempt', {
          url,
          attempt,
          totalAttempts: retries,
          optimizations: ['Max 100 pages', '2-level depth', '5min timeout'],
          outputDir,
          timestamp: new Date().toISOString()
        });
        
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 20 * 1024 * 1024, // 20MB buffer
          timeout: 5 * 60 * 1000, // REDUCED to 5 minutes total timeout
          env: { ...process.env, LANG: 'en_US.UTF-8' },
        });

        const duration = Date.now() - startTime;

        // Filter meaningful output and reduce noise
        const meaningfulOutput = this._filterMeaningfulOutput(stdout);
        const { warnings, errors } = this._categorizeStderr(stderr);
        
        // Only log meaningful info to reduce console noise
        if (meaningfulOutput) {
          logger.info(`Crawl completed: ${meaningfulOutput}`);
        }
        
        // Only log errors, not info/warnings in stderr
        if (errors.length > 0) {
          logger.warn(`Crawl errors: ${errors.join('; ')}`);
        }

        workflowLogger.info('Fast crawl completed', {
          url,
          attempt,
          duration,
          success: true,
          performance: this._analyzePerformance(duration, stdout),
          outputDir
        });

        // Quick validation
        await this._validateOutputFiles(outputDir, url, attempt);
        
        return { stdout, stderr, duration };
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error(`Crawl attempt ${attempt} failed: ${error.message}`);
        workflowLogger.error('Crawl failure', {
          url,
          attempt,
          duration,
          error: error.message,
          isTimeout: error.signal === 'SIGTERM' || error.message.includes('timeout')
        });
        
        if (attempt === retries) {
          throw new Error(`Fast crawl failed after ${retries} attempts: ${error.message}`);
        }
        
        await this._waitForRetry(attempt);
      }
    }
  }

  _buildOptimizedCommand(url, outputDir) {
    const baseCommand = config.isWindows ? 
      `"${config.paths.screamingFrogCli}"` : 
      `bash "${config.paths.screamingFrogCli}"`;

    // AGGRESSIVE PERFORMANCE OPTIMIZATIONS for speed
    const optimizedFlags = [
      `"${url}"`, // URL as first argument for script
      `"${outputDir}"` // Output dir as second argument for script
    ];

    return `${baseCommand} ${optimizedFlags.join(' ')}`;
  }

  _filterMeaningfulOutput(stdout) {
    if (!stdout) return '';
    
    const lines = stdout.split('\n');
    const meaningfulLines = lines.filter(line => {
      const lowerLine = line.toLowerCase();
      return (
        lowerLine.includes('success') ||
        lowerLine.includes('found internal_all.csv') ||
        lowerLine.includes('total execution time') ||
        lowerLine.includes('script completed') ||
        (lowerLine.includes('error') && !lowerLine.includes('0 errors'))
      );
    });
    
    return meaningfulLines.join('; ').trim();
  }

  _categorizeStderr(stderr) {
    if (!stderr) return { warnings: [], errors: [] };
    
    const lines = stderr.split('\n');
    const warnings = [];
    const errors = [];
    
    lines.forEach(line => {
      const lowerLine = line.toLowerCase().trim();
      
      if (!lowerLine) return;
      
      // Skip ALL INFO logs that are duplicated in stderr
      if (
        lowerLine.includes('[info]') ||
        lowerLine.includes('crawler started') ||
        lowerLine.includes('script:') ||
        lowerLine.includes('user:') ||
        lowerLine.includes('date:') ||
        lowerLine.includes('url:') ||
        lowerLine.includes('output directory:') ||
        lowerLine.includes('export tabs:') ||
        lowerLine.includes('system checks') ||
        lowerLine.includes('success:') ||
        lowerLine.includes('csv contains') ||
        lowerLine.includes('final status') ||
        lowerLine.includes('script completed') ||
        lowerLine.includes('total execution time')
      ) {
        return; // Skip these INFO messages that are just noise
      }
      
      // Only capture real errors
      if (
        lowerLine.includes('error') ||
        lowerLine.includes('failed') ||
        lowerLine.includes('exception') ||
        lowerLine.includes('fatal') ||
        lowerLine.includes('out of memory') ||
        lowerLine.includes('timeout')
      ) {
        errors.push(line.trim());
      }
      // Capture real warnings (not INFO logs)
      else if (
        lowerLine.includes('warn') && !lowerLine.includes('[info]')
      ) {
        warnings.push(line.trim());
      }
    });
    
    return { warnings, errors };
  }

  _analyzePerformance(duration, stdout) {
    const analysis = { duration, status: 'good', notes: [] };
    
    if (duration > 300000) { // 5 minutes
      analysis.status = 'too_slow';
      analysis.notes.push('Crawl exceeded 5 minutes - consider smaller sites');
    } else if (duration > 120000) { // 2 minutes
      analysis.status = 'acceptable';
      analysis.notes.push('Crawl took 2-5 minutes');
    } else {
      analysis.notes.push('Fast crawl performance');
    }
    
    // Extract page count if available
    if (stdout) {
      const csvMatch = stdout.match(/Found internal_all\.csv.*?(\d+)\s+lines/i);
      if (csvMatch) {
        const lines = parseInt(csvMatch[1]);
        analysis.pagesFound = Math.max(0, lines - 1); // Subtract header
      }
    }
    
    return analysis;
  }

  async _validateOutputFiles(outputDir, url, attempt) {
    try {
      const fs = require('fs').promises;
      const filePath = path.join(outputDir, 'internal_all.csv');
      
      try {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        
        workflowLogger.info('Crawl validation successful', {
          url,
          attempt,
          fileSize: `${(stats.size / 1024).toFixed(1)} KB`,
          pagesFound: Math.max(0, lines.length - 1),
          hasData: lines.length > 1
        });
        
      } catch (fileError) {
        workflowLogger.warn('CSV file validation failed', {
          url,
          attempt,
          error: fileError.message,
          expectedPath: filePath
        });
      }

    } catch (error) {
      workflowLogger.error('Validation error', {
        url,
        attempt,
        error: error.message
      });
    }
  }

  async _waitForRetry(attempt) {
    const delay = 5000; // Fixed 5 second delay
    logger.info(`Waiting ${delay}ms before retry...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

module.exports = new CrawlerService();