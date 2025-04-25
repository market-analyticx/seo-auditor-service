// scripts/crawl.js
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const workflowLogger = require('../src/utils/workflowLogger');
require('dotenv').config();

const execAsync = promisify(exec);

// Configuration
const config = {
  paths: {
    exportsDir: process.env.EXPORTS_DIR || path.join(__dirname, '..', 'exports'),
    screamingFrogCli: process.env.SF_CLI_PATH || 'ScreamingFrogSEOSpiderCli',
  },
  retries: {
    maxAttempts: parseInt(process.env.MAX_RETRIES) || 3,
    backoffMs: parseInt(process.env.RETRY_BACKOFF_MS) || 1000,
  },
};

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'crawler' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Input validation
function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Generate safe slug from URL
function generateSlug(url) {
  return url
    .replace(/https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

// Ensure directory exists
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
    logger.info(`Created directory: ${dirPath}`);
    workflowLogger.info('Directory created', { path: dirPath });
  }
}

// Execute crawl with retries
async function executeCrawl(url, outputDir, retries = config.retries.maxAttempts) {
  const command = `"${config.paths.screamingFrogCli}" \
    --crawl "${url}" \
    --headless \
    --save-crawl \
    --export-tabs "Internal:All" \
    --output-folder "${outputDir}"`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.info(`Executing crawl (attempt ${attempt}/${retries}): ${url}`);
      workflowLogger.info('Crawl attempt', { url, attempt, maxAttempts: retries });
      
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 30 * 60 * 1000, // 30 minutes timeout
      });

      if (stderr) {
        logger.warn(`Crawl stderr: ${stderr}`);
        workflowLogger.debug('Crawl stderr', { stderr });
      }
      
      logger.info(`Crawl stdout: ${stdout}`);
      workflowLogger.debug('Crawl stdout', { stdout });
      
      return { stdout, stderr };
    } catch (error) {
      logger.error(`Crawl attempt ${attempt} failed: ${error.message}`);
      workflowLogger.error('Crawl attempt failed', { 
        url, 
        attempt, 
        error: error.message 
      });
      
      if (attempt === retries) {
        throw new Error(`Crawl failed after ${retries} attempts: ${error.message}`);
      }
      
      // Exponential backoff
      const delay = config.retries.backoffMs * Math.pow(2, attempt - 1);
      logger.info(`Waiting ${delay}ms before retry...`);
      workflowLogger.debug('Waiting for retry', { delay });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Main crawl function
async function crawlWebsite(url, slug) {
  const startTime = Date.now();
  logger.info(`Starting crawl for URL: ${url} with slug: ${slug}`);
  workflowLogger.info('Starting crawl', { url, slug });

  try {
    // Validate input
    if (!url || !validateUrl(url)) {
      workflowLogger.error('Invalid URL', { url });
      throw new Error('Invalid URL provided');
    }

    // Use the same directory structure as before for n8n compatibility
    const outputDir = path.join(config.paths.exportsDir, slug);

    // If folder exists, delete it (matching original behavior)
    try {
      await fs.rm(outputDir, { recursive: true, force: true });
      logger.info(`Removed existing folder: ${outputDir}`);
      workflowLogger.info('Removed existing folder', { path: outputDir });
    } catch (error) {
      // Folder might not exist, which is fine
    }

    // Create the folder
    await ensureDirectoryExists(outputDir);

    // Execute crawl
    await executeCrawl(url, outputDir);

    const duration = Date.now() - startTime;
    logger.info(`Crawl completed in ${duration}ms`);
    workflowLogger.info('Crawl completed', { 
      url, 
      slug, 
      duration,
      outputDir 
    });

    // Return simple success for n8n
    return {
      success: true,
      outputDir,
      duration,
    };
  } catch (error) {
    logger.error(`Crawl failed: ${error.message}`);
    workflowLogger.error('Crawl failed', { 
      url, 
      slug, 
      error: error.message,
      duration: Date.now() - startTime
    });
    throw error;
  }
}

// CLI interface (compatible with n8n command)
if (require.main === module) {
  const url = process.argv[2];
  const slug = process.argv[3] || generateSlug(url);

  if (!url) {
    console.error('❌ Please provide a URL as the first argument.');
    workflowLogger.error('No URL provided in CLI');
    process.exit(1);
  }

  crawlWebsite(url, slug)
    .then(result => {
      console.log(`✅ Crawl completed successfully`);
      process.exit(0);
    })
    .catch(error => {
      console.error(`❌ Crawl failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  crawlWebsite,
  generateSlug,
  validateUrl,
};