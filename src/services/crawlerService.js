// src/services/crawlerService.js
const { exec } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');
const config = require('../config');
const path = require('path');

const execAsync = promisify(exec);

class CrawlerService {
  async execute(url, outputDir, retries = config.retries.maxAttempts) {
    const command = this._buildCommand(url, outputDir);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Executing crawl (attempt ${attempt}/${retries}): ${url}`);
        
        const { stdout, stderr } = await execAsync(command, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 30 * 60 * 1000, // 30 minutes timeout
        });

        if (stderr) {
          logger.warn(`Crawl stderr: ${stderr}`);
        }
        
        logger.info(`Crawl stdout: ${stdout}`);
        return { stdout, stderr };
      } catch (error) {
        logger.error(`Crawl attempt ${attempt} failed: ${error.message}`);
        
        if (attempt === retries) {
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
        return `${path.resolve(process.cwd(), config.paths.screamingFrogCli)} "${url}" "${outputDir}"`;
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
      // Default case
      return `"${config.paths.screamingFrogCli}" "${url}" "${outputDir}"`;
    }
  }

  async _waitForRetry(attempt) {
    const delay = config.retries.backoffMs * Math.pow(2, attempt - 1);
    logger.info(`Waiting ${delay}ms before retry...`);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

module.exports = new CrawlerService();