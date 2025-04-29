// scripts/run-workflow.js
const path = require('path');
const dotenv = require('dotenv');
const workflowLogger = require('../src/utils/workflowLogger');
const { validateUrl, generateSlug } = require('../src/utils/validation');
const crawlController = require('../src/controllers/crawlController');
const auditController = require('../src/controllers/auditController');

// Load environment variables
dotenv.config();

// Main workflow execution function
async function executeWorkflow(inputData) {
  try {
    // Validate URL
    const url = inputData.url || 
               (inputData.body && inputData.body.url) || 
               (inputData.query && inputData.query.url);

    if (!url || !validateUrl(url)) {
      throw new Error('Invalid URL provided');
    }

    // Generate slug
    const slug = generateSlug(url);
    const jobId = `job_${Date.now()}`;

    workflowLogger.info('Starting workflow execution', { url, slug });

    // Step 1: Crawl Website
    const crawlResult = await crawlController.crawlWebsite(url, slug);
    workflowLogger.info('Crawl completed', crawlResult);

    // Step 2: Audit Crawled Data
    const auditResult = await auditController.analyzeWebsite(slug);
    workflowLogger.info('Audit completed', auditResult);

    // Prepare final result
    const result = {
      jobId,
      url,
      slug,
      status: 'success',
      timestamp: new Date().toISOString(),
      crawlResult,
      auditResult
    };

    return result;
  } catch (error) {
    workflowLogger.error('Workflow execution failed', { 
      error: error.message,
      stack: error.stack
    });

    throw error;
  }
}

// Check if run directly from CLI
if (require.main === module) {
  const inputData = { url: process.argv[2] };

  executeWorkflow(inputData)
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('Workflow execution error:', error);
      process.exit(1);
    });
}

module.exports = { executeWorkflow };