// src/services/crawlerService.js - Fixed to work with your existing Screaming Frog setup
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config');
const path = require('path');

const execAsync = promisify(exec);

class CrawlerService {
  async execute(url, outputDir, retries = config.retries.maxAttempts) {
    // Smart settings based on simple URL analysis
    const crawlSettings = this._getSmartCrawlSettings(url);
    const command = this._buildCompatibleCommand(url, outputDir, crawlSettings);

    for (let attempt = 1; attempt <= retries; attempt++) {
      const startTime = Date.now();
      
      try {
        logger.info(`Executing compatible crawl (attempt ${attempt}/${retries}): ${url}`);
        workflowLogger.info('Starting compatible crawl attempt', {
          url,
          attempt,
          totalAttempts: retries,
          crawlSettings,
          outputDir,
          timestamp: new Date().toISOString()
        });
        
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large sites
          timeout: crawlSettings.timeout,
          env: { ...process.env, LANG: 'en_US.UTF-8' },
        });

        const duration = Date.now() - startTime;

        // Filter output intelligently - reduce noise but keep important info
        const meaningfulOutput = this._extractMeaningfulOutput(stdout);
        const { errors, warnings } = this._categorizeStderr(stderr);
        
        // Log results concisely
        if (meaningfulOutput) {
          logger.info(`Crawl completed: ${meaningfulOutput}`);
        }
        
        // Only log real errors, not duplicate info messages
        if (errors.length > 0) {
          logger.warn(`Crawl errors: ${errors.slice(0, 3).join('; ')}`);
        }

        workflowLogger.info('Compatible crawl completed', {
          url,
          attempt,
          duration,
          success: true,
          crawlSettings,
          performance: this._analyzePerformance(duration, stdout, crawlSettings),
          outputDir
        });

        // Quick but thorough validation
        await this._validateOutputFiles(outputDir, url, attempt);
        
        return { stdout, stderr, duration, crawlSettings };
        
      } catch (error) {
        const duration = Date.now() - startTime;
        
        logger.error(`Crawl attempt ${attempt} failed: ${error.message}`);
        workflowLogger.error('Crawl failure', {
          url,
          attempt,
          duration,
          crawlSettings,
          error: error.message,
          isTimeout: error.signal === 'SIGTERM' || error.message.includes('timeout'),
          recommendation: this._getQuickRecommendation(error, crawlSettings)
        });
        
        if (attempt === retries) {
          throw new Error(`Compatible crawl failed after ${retries} attempts: ${error.message}`);
        }
        
        await this._waitForRetry(attempt);
      }
    }
  }

  // Smart settings based on URL patterns and common site characteristics
  _getSmartCrawlSettings(url) {
    const domain = url.replace(/https?:\/\//, '').split('/')[0];
    
    // Default settings - good for most sites
    const settings = {
      timeout: 20 * 60 * 1000,  // 20 minutes default
      heapSize: '6g',          // Good default
      reasoning: []
    };

    // Adjust for known large platforms
    const largePlatforms = [
      'shopify.', 'woocommerce.', 'magento.', 'bigcommerce.',
      'wordpress.', 'drupal.', 'joomla.',
      'github.', 'gitlab.', 'bitbucket.',
      'medium.', 'substack.', 'ghost.',
      'squarespace.', 'wix.', 'webflow.',
      'docs.', 'documentation.', 'help.', 'support.'
    ];

    if (largePlatforms.some(platform => domain.includes(platform) || url.includes(platform))) {
      settings.timeout = 30 * 60 * 1000; // 30 minutes
      settings.heapSize = '8g';
      settings.reasoning.push('Large platform detected');
    }

    // Documentation sites often have many pages
    const docPatterns = [
      'docs.', 'documentation.', 'help.', 'support.', 'api.',
      '/docs', '/documentation', '/help', '/support', '/api'
    ];
    
    if (docPatterns.some(pattern => url.includes(pattern) || domain.includes(pattern))) {
      settings.timeout = 25 * 60 * 1000; // 25 minutes
      settings.heapSize = '6g';
      settings.reasoning.push('Documentation site detected');
    }

    // Override for testing/development
    if (process.env.CRAWL_MODE === 'fast') {
      settings.timeout = 8 * 60 * 1000; // 8 minutes
      settings.heapSize = '4g';
      settings.reasoning.push('Fast mode enabled');
    } else if (process.env.CRAWL_MODE === 'comprehensive') {
      settings.timeout = 45 * 60 * 1000; // 45 minutes
      settings.heapSize = '8g';
      settings.reasoning.push('Comprehensive mode enabled');
    }

    workflowLogger.info('Smart crawl settings determined', {
      url,
      domain,
      settings,
      reasoning: settings.reasoning
    });

    return settings;
  }

  // Build command using your existing script - FIXED to use simple export format
  _buildCompatibleCommand(url, outputDir, settings) {
    const scriptPath = config.paths.screamingFrogCli;
    
    // Use simple "Internal:All" export that works with your SF version
    // The comma-separated exports were causing the failures
    const exportTabs = "Internal:All";
    
    return `JAVA_HEAP_SIZE=${settings.heapSize} bash "${scriptPath}" "${url}" "${outputDir}" "${exportTabs}"`;
  }

  _extractMeaningfulOutput(stdout) {
    if (!stdout) return '';
    
    const lines = stdout.split('\n');
    const meaningfulLines = lines.filter(line => {
      const lowerLine = line.toLowerCase();
      return (
        lowerLine.includes('success:') ||
        lowerLine.includes('found internal_all.csv') ||
        lowerLine.includes('total execution time') ||
        lowerLine.includes('script completed') ||
        lowerLine.includes('csv contains data') ||
        lowerLine.includes('crawl completed') ||
        lowerLine.includes('data rows') ||
        (lowerLine.includes('error') && !lowerLine.includes('sf-err'))
      );
    });
    
    return meaningfulLines.slice(0, 5).join('; ').trim(); // Limit to top 5 meaningful lines
  }

  _categorizeStderr(stderr) {
    if (!stderr) return { warnings: [], errors: [] };
    
    const lines = stderr.split('\n');
    const warnings = [];
    const errors = [];
    
    lines.forEach(line => {
      const lowerLine = line.toLowerCase().trim();
      
      if (!lowerLine) return;
      
      // Skip all the INFO messages that appear in stderr (they're just noise)
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
        lowerLine.includes('java found:') ||
        lowerLine.includes('screaming frog jar found:') ||
        lowerLine.includes('output directory ready:') ||
        lowerLine.includes('url is accessible') ||
        lowerLine.includes('building') ||
        lowerLine.includes('heap detected') ||
        lowerLine.includes('crawl settings:') ||
        lowerLine.includes('using timeout') ||
        lowerLine.includes('final command:') ||
        lowerLine.includes('seo data collection') ||
        lowerLine.includes('crawl started at:') ||
        lowerLine.includes('sf-out:') ||
        lowerLine.includes('output validation') ||
        lowerLine.includes('found') && lowerLine.includes('files') ||
        lowerLine.includes('success:') ||
        lowerLine.includes('csv contains') ||
        lowerLine.includes('final status') ||
        lowerLine.includes('script completed') ||
        lowerLine.includes('total execution time') ||
        lowerLine.includes('log file:')
      ) {
        return; // Skip these INFO messages
      }
      
      // Capture real errors
      if (
        lowerLine.includes('error:') ||
        lowerLine.includes('failed:') ||
        lowerLine.includes('exception') ||
        lowerLine.includes('fatal') ||
        lowerLine.includes('out of memory') ||
        lowerLine.includes('connection refused') ||
        lowerLine.includes('timeout exceeded') ||
        (lowerLine.includes('sf-err:') && (
          lowerLine.includes('error') || 
          lowerLine.includes('exception') || 
          lowerLine.includes('failed')
        ))
      ) {
        errors.push(line.trim());
      }
      // Capture real warnings
      else if (
        lowerLine.includes('warn:') ||
        lowerLine.includes('warning:') ||
        (lowerLine.includes('sf-err:') && lowerLine.includes('warn'))
      ) {
        warnings.push(line.trim());
      }
    });
    
    return { warnings, errors };
  }

  _analyzePerformance(duration, stdout, settings) {
    const analysis = {
      duration,
      status: 'good',
      notes: [],
      efficiency: {}
    };
    
    // Performance assessment based on settings
    if (duration > settings.timeout * 0.8) {
      analysis.status = 'slow';
      analysis.notes.push('Crawl took most of allocated timeout');
    } else if (duration > 15 * 60 * 1000) { // 15 minutes
      analysis.status = 'slower_than_expected';
      analysis.notes.push('Crawl slower than expected');
    } else if (duration < 2 * 60 * 1000) { // 2 minutes
      analysis.status = 'very_fast';
      analysis.notes.push('Crawl completed very quickly');
    } else {
      analysis.notes.push('Good crawl performance');
    }
    
    // Extract page count for efficiency calculation
    if (stdout) {
      const csvMatch = stdout.match(/Found internal_all\.csv.*?(\d+)\s+lines/i);
      if (csvMatch) {
        const lines = parseInt(csvMatch[1]);
        const pagesFound = Math.max(0, lines - 1);
        analysis.efficiency.pagesFound = pagesFound;
        analysis.efficiency.pagesPerSecond = (pagesFound / (duration / 1000)).toFixed(2);
      }
      
      // Look for data rows mention
      const dataRowsMatch = stdout.match(/(\d+)\s+data\s+rows/i);
      if (dataRowsMatch) {
        analysis.efficiency.dataRows = parseInt(dataRowsMatch[1]);
      }
    }
    
    return analysis;
  }

  _getQuickRecommendation(error, settings) {
    if (error.signal === 'SIGTERM' || error.message.includes('timeout')) {
      return `Increase timeout beyond ${Math.floor(settings.timeout / 60000)} minutes`;
    } else if (error.message.includes('memory')) {
      return `Increase heap size beyond ${settings.heapSize}`;
    } else if (error.code === 'ENOENT') {
      return 'Check Screaming Frog installation and script path';
    } else if (error.message.includes('exit code 1')) {
      return 'Check Screaming Frog compatibility and export tab format';
    } else {
      return 'Check website accessibility and crawler permissions';
    }
  }

  async _validateOutputFiles(outputDir, url, attempt) {
    try {
      const fs = require('fs').promises;
      const csvPath = path.join(outputDir, 'internal_all.csv');
      
      try {
        const stats = await fs.stat(csvPath);
        const content = await fs.readFile(csvPath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());
        const dataRows = Math.max(0, lines.length - 1);
        
        workflowLogger.info('Crawl validation successful', {
          url,
          attempt,
          fileSize: `${(stats.size / 1024).toFixed(1)} KB`,
          totalLines: lines.length,
          dataRows: dataRows,
          hasData: dataRows > 0
        });
        
        if (dataRows === 0) {
          workflowLogger.warn('CSV file has no data rows', {
            url,
            attempt,
            possibleCauses: [
              'Website blocks crawlers',
              'Requires authentication', 
              'No crawlable content',
              'Robots.txt restrictions'
            ]
          });
        }
        
      } catch (fileError) {
        workflowLogger.warn('CSV file validation failed', {
          url,
          attempt,
          error: fileError.message,
          expectedPath: csvPath
        });
      }

    } catch (error) {
      workflowLogger.error('Output validation error', {
        url,
        attempt,
        error: error.message
      });
    }
  }

  async _waitForRetry(attempt) {
    const delay = 5000; // Fixed 5 second delay - simple and effective
    logger.info(`Waiting ${delay}ms before retry...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

module.exports = new CrawlerService();