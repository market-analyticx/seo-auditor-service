// src/services/crawlerService.js - Enhanced with detailed error logging
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');
const workflowLogger = require('../utils/workflowLogger');
const config = require('../config');
const path = require('path');

const execAsync = promisify(exec);

class CrawlerService {
  async execute(url, outputDir, retries = config.retries.maxAttempts) {
    const command = this._buildCommand(url, outputDir);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Executing crawl (attempt ${attempt}/${retries}): ${url}`);
        workflowLogger.info('Starting crawl attempt', {
          url,
          attempt,
          totalAttempts: retries,
          command: command.substring(0, 200) + '...', // Log first 200 chars of command
          outputDir,
          timestamp: new Date().toISOString()
        });
        
        const startTime = Date.now();
        
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 30 * 60 * 1000, // 30 minutes timeout
          env: { ...process.env, LANG: 'en_US.UTF-8' }, // Ensure consistent output
        });

        const duration = Date.now() - startTime;

        // Enhanced success logging
        workflowLogger.info('Crawl attempt completed', {
          url,
          attempt,
          duration,
          success: true,
          stdoutLength: stdout ? stdout.length : 0,
          stderrLength: stderr ? stderr.length : 0,
          outputDir
        });

        // Log stdout details (but limit size for readability)
        if (stdout) {
          const stdoutPreview = stdout.length > 1000 ? 
            stdout.substring(0, 500) + '\n...[truncated]...\n' + stdout.substring(stdout.length - 500) :
            stdout;
          
          logger.info(`Crawl stdout (${stdout.length} chars): ${stdoutPreview}`);
          workflowLogger.debug('Crawl stdout details', {
            url,
            attempt,
            fullStdout: stdout,
            stdoutLines: stdout.split('\n').length
          });
        }

        // Log stderr details (these might contain important warnings)
        if (stderr) {
          const stderrPreview = stderr.length > 1000 ? 
            stderr.substring(0, 500) + '\n...[truncated]...\n' + stderr.substring(stderr.length - 500) :
            stderr;
          
          logger.warn(`Crawl stderr (${stderr.length} chars): ${stderrPreview}`);
          workflowLogger.warn('Crawl stderr details', {
            url,
            attempt,
            fullStderr: stderr,
            stderrLines: stderr.split('\n').length
          });
        }

        // Check if output files were actually created
        await this._validateOutputFiles(outputDir, url, attempt);
        
        return { stdout, stderr };
        
      } catch (error) {
        const duration = Date.now() - startTime || 0;
        
        // Enhanced error logging with detailed information
        const errorDetails = {
          url,
          attempt,
          totalAttempts: retries,
          duration,
          errorMessage: error.message,
          errorCode: error.code,
          errorSignal: error.signal,
          killed: error.killed,
          stdout: error.stdout,
          stderr: error.stderr,
          command: command.substring(0, 200) + '...',
          outputDir,
          timestamp: new Date().toISOString()
        };

        logger.error(`Crawl attempt ${attempt} failed: ${error.message}`);
        workflowLogger.error('Detailed crawl failure', errorDetails);

        // Log specific error patterns we can recognize
        this._analyzeError(error, url, attempt);
        
        if (attempt === retries) {
          // Final failure - log comprehensive details
          workflowLogger.error('All crawl attempts failed', {
            url,
            totalAttempts: retries,
            finalError: errorDetails,
            troubleshooting: this._generateTroubleshootingInfo(error, url)
          });
          
          throw new Error(`Crawl failed after ${retries} attempts: ${error.message}`);
        }
        
        await this._waitForRetry(attempt);
      }
    }
  }

  _buildCommand(url, outputDir) {
    // For Windows: use the .exe file directly
    if (config.isWindows) {
      return `"${config.paths.screamingFrogCli}" \
        --crawl "${url}" \
        --headless \
        --save-crawl \
        --export-tabs "Internal:All" \
        --output-folder "${outputDir}"`;
    } 
    // For Linux/macOS: use the shell script or direct JAR execution
    else {
      // If it's a shell script
      if (config.paths.screamingFrogCli.endsWith('.sh')) {
        return `bash "${path.resolve(process.cwd(), config.paths.screamingFrogCli)}" "${url}" "${outputDir}"`;
      } 
      // If it's a JAR file
      else if (config.paths.screamingFrogCli.endsWith('.jar')) {
        return `java -jar "${config.paths.screamingFrogCli}" \
          --crawl "${url}" \
          --headless \
          --save-crawl \
          --export-tabs "Internal:All" \
          --output-folder "${outputDir}"`;
      }
      // Default case - assume it's an executable
      return `"${config.paths.screamingFrogCli}" "${url}" "${outputDir}"`;
    }
  }

  async _validateOutputFiles(outputDir, url, attempt) {
    try {
      const fs = require('fs').promises;
      const expectedFiles = [
        'internal_all.csv',
        // Add other expected files if needed
      ];

      const validationResults = {};
      
      for (const fileName of expectedFiles) {
        const filePath = path.join(outputDir, fileName);
        try {
          const stats = await fs.stat(filePath);
          validationResults[fileName] = {
            exists: true,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
          
          // Check if CSV file has content (more than just headers)
          if (fileName.endsWith('.csv')) {
            const content = await fs.readFile(filePath, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());
            validationResults[fileName].lineCount = lines.length;
            validationResults[fileName].hasData = lines.length > 1;
          }
          
        } catch (fileError) {
          validationResults[fileName] = {
            exists: false,
            error: fileError.message
          };
        }
      }

      workflowLogger.info('Output file validation', {
        url,
        attempt,
        outputDir,
        files: validationResults
      });

      // Check if main CSV file exists and has data
      const mainCsv = validationResults['internal_all.csv'];
      if (!mainCsv || !mainCsv.exists) {
        workflowLogger.warn('Main CSV file missing', {
          url,
          attempt,
          outputDir,
          expectedPath: path.join(outputDir, 'internal_all.csv')
        });
      } else if (mainCsv.size === 0) {
        workflowLogger.warn('Main CSV file is empty', {
          url,
          attempt,
          outputDir,
          filePath: path.join(outputDir, 'internal_all.csv')
        });
      } else if (!mainCsv.hasData) {
        workflowLogger.warn('Main CSV file has no data rows', {
          url,
          attempt,
          outputDir,
          lineCount: mainCsv.lineCount
        });
      }

    } catch (error) {
      workflowLogger.error('Output file validation failed', {
        url,
        attempt,
        outputDir,
        error: error.message
      });
    }
  }

  _analyzeError(error, url, attempt) {
    const analysis = {
      url,
      attempt,
      errorType: 'unknown',
      likelyCause: 'unknown',
      suggestedFix: 'unknown'
    };

    // Analyze error message patterns
    const errorMsg = error.message.toLowerCase();
    
    if (error.code === 'ENOENT') {
      analysis.errorType = 'file_not_found';
      analysis.likelyCause = 'Screaming Frog CLI not found or not executable';
      analysis.suggestedFix = 'Check SF_CLI_PATH environment variable and file permissions';
    }
    else if (error.signal === 'SIGTERM' || errorMsg.includes('timeout')) {
      analysis.errorType = 'timeout';
      analysis.likelyCause = 'Crawl took longer than allowed timeout period';
      analysis.suggestedFix = 'Increase timeout or limit crawl scope';
    }
    else if (errorMsg.includes('java')) {
      analysis.errorType = 'java_related';
      analysis.likelyCause = 'Java runtime issue or insufficient memory';
      analysis.suggestedFix = 'Check Java installation and increase heap size';
    }
    else if (errorMsg.includes('command failed')) {
      analysis.errorType = 'command_execution';
      analysis.likelyCause = 'Screaming Frog process failed internally';
      analysis.suggestedFix = 'Check Screaming Frog logs and system resources';
    }
    else if (errorMsg.includes('permission')) {
      analysis.errorType = 'permission_denied';
      analysis.likelyCause = 'Insufficient permissions to run crawler or write files';
      analysis.suggestedFix = 'Check file permissions and user privileges';
    }

    // Check stderr for specific patterns
    if (error.stderr) {
      const stderrLower = error.stderr.toLowerCase();
      if (stderrLower.includes('out of memory') || stderrLower.includes('heap space')) {
        analysis.errorType = 'memory_issue';
        analysis.likelyCause = 'Insufficient memory for large site crawl';
        analysis.suggestedFix = 'Increase Java heap size or limit crawl scope';
      }
      else if (stderrLower.includes('connection') || stderrLower.includes('timeout')) {
        analysis.errorType = 'network_issue';
        analysis.likelyCause = 'Network connectivity problems or slow site response';
        analysis.suggestedFix = 'Check network connection and site accessibility';
      }
    }

    workflowLogger.info('Error analysis completed', analysis);
    
    // Log human-readable interpretation
    logger.error(`Error Analysis for ${url}:`);
    logger.error(`  Type: ${analysis.errorType}`);
    logger.error(`  Likely Cause: ${analysis.likelyCause}`);
    logger.error(`  Suggested Fix: ${analysis.suggestedFix}`);
  }

  _generateTroubleshootingInfo(error, url) {
    return {
      steps: [
        'Check if Screaming Frog CLI is properly installed and accessible',
        'Verify the URL is accessible from the server',
        'Check available disk space and memory',
        'Review Screaming Frog logs for detailed error messages',
        'Consider reducing crawl scope for large sites',
        'Verify Java installation and version compatibility'
      ],
      commonIssues: {
        'ENOENT': 'Screaming Frog CLI not found - check SF_CLI_PATH',
        'SIGTERM': 'Process timeout - increase timeout or reduce scope',
        'heap space': 'Memory issue - increase Java heap size',
        'connection': 'Network issue - check connectivity to target site'
      },
      debugCommands: [
        'Test SF CLI manually: ' + config.paths.screamingFrogCli + ' --version',
        'Check URL accessibility: curl -I ' + url,
        'Check disk space: df -h',
        'Check memory: free -h'
      ]
    };
  }

  async _waitForRetry(attempt) {
    const delay = config.retries.backoffMs * Math.pow(2, attempt - 1);
    logger.info(`Waiting ${delay}ms before retry...`);
    workflowLogger.info('Waiting for retry', {
      attempt,
      nextAttempt: attempt + 1,
      delay,
      delaySeconds: Math.round(delay / 1000)
    });
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

module.exports = new CrawlerService();