// scripts/run-workflow.js - Enhanced with detailed error context and logging
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
  const sessionId = `workflow_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  let currentStep = 'initialization';
  
  try {
    // Create workflow session
    workflowLogger.createSession(sessionId, {
      inputData: inputData,
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      platform: process.platform
    });

    workflowLogger.logSession(sessionId, 'INFO', 'Workflow execution started', {
      step: currentStep
    });

    // Step 1: Extract and validate URL
    currentStep = 'url_validation';
    workflowLogger.logSession(sessionId, 'INFO', 'Starting URL validation', {
      step: currentStep
    });

    const url = inputData.url || 
               (inputData.body && inputData.body.url) || 
               (inputData.query && inputData.query.url);

    if (!url || !validateUrl(url)) {
      const error = new Error('Invalid URL provided');
      workflowLogger.logErrorWithContext(error, {
        sessionId,
        step: currentStep,
        providedUrl: url,
        inputData: inputData
      });
      throw error;
    }

    // Generate slug and job metadata
    const slug = generateSlug(url);
    const jobId = sessionId; // Use session ID as job ID for consistency

    workflowLogger.logSession(sessionId, 'INFO', 'URL validation completed', {
      step: currentStep,
      url: url,
      slug: slug,
      jobId: jobId
    });

    // Step 2: Website Crawling
    currentStep = 'website_crawling';
    workflowLogger.logSession(sessionId, 'INFO', 'Starting website crawl', {
      step: currentStep,
      url: url,
      slug: slug
    });

    const crawlStartTime = Date.now();
    let crawlResult;
    
    try {
      crawlResult = await crawlController.crawlWebsite(url, slug);
      
      const crawlDuration = Date.now() - crawlStartTime;
      workflowLogger.logSession(sessionId, 'INFO', 'Website crawl completed', {
        step: currentStep,
        duration: crawlDuration,
        success: crawlResult.success,
        outputDir: crawlResult.outputDir
      });
      
    } catch (crawlError) {
      const crawlDuration = Date.now() - crawlStartTime;
      
      workflowLogger.logErrorWithContext(crawlError, {
        sessionId,
        step: currentStep,
        url: url,
        slug: slug,
        duration: crawlDuration,
        errorType: 'crawl_failure',
        troubleshooting: {
          possibleCauses: [
            'Large website causing timeout',
            'Screaming Frog CLI not found or misconfigured',
            'Insufficient system resources (memory/disk)',
            'Network connectivity issues',
            'Target website blocking crawlers'
          ],
          nextSteps: [
            'Check Screaming Frog CLI installation',
            'Verify URL accessibility',
            'Check system resources',
            'Review crawl configuration',
            'Consider reducing crawl scope'
          ]
        }
      });
      
      throw crawlError;
    }

    // Step 3: SEO Analysis
    currentStep = 'seo_analysis';
    workflowLogger.logSession(sessionId, 'INFO', 'Starting SEO analysis', {
      step: currentStep,
      slug: slug
    });

    const auditStartTime = Date.now();
    let auditResult;
    
    try {
      auditResult = await auditController.analyzeWebsite(slug);
      
      const auditDuration = Date.now() - auditStartTime;
      workflowLogger.logSession(sessionId, 'INFO', 'SEO analysis completed', {
        step: currentStep,
        duration: auditDuration,
        success: auditResult.success,
        reportPath: auditResult.reportPath,
        summary: auditResult.summary
      });
      
    } catch (auditError) {
      const auditDuration = Date.now() - auditStartTime;
      
      workflowLogger.logErrorWithContext(auditError, {
        sessionId,
        step: currentStep,
        slug: slug,
        duration: auditDuration,
        errorType: 'audit_failure',
        troubleshooting: {
          possibleCauses: [
            'OpenAI API key not configured',
            'CSV file not found or corrupted',
            'OpenAI API rate limits exceeded',
            'Insufficient AI model tokens',
            'Network issues with OpenAI API'
          ],
          nextSteps: [
            'Verify OPENAI_API_KEY environment variable',
            'Check CSV file exists and has data',
            'Review OpenAI API usage and limits',
            'Check network connectivity to OpenAI',
            'Verify CSV file format and content'
          ]
        }
      });
      
      throw auditError;
    }

    // Step 4: Prepare final result
    currentStep = 'result_preparation';
    workflowLogger.logSession(sessionId, 'INFO', 'Preparing final result', {
      step: currentStep
    });

    const totalDuration = Date.now() - crawlStartTime;
    const result = {
      jobId,
      sessionId,
      url,
      slug,
      status: 'success',
      timestamp: new Date().toISOString(),
      crawlResult,
      auditResult,
      performance: {
        totalDuration,
        crawlDuration: crawlResult.duration,
        auditDuration: auditResult.duration
      },
      metadata: {
        version: '2.0.0',
        environment: process.env.NODE_ENV || 'development',
        processedAt: new Date().toISOString()
      }
    };

    workflowLogger.logSession(sessionId, 'INFO', 'Workflow completed successfully', {
      step: 'completed',
      totalDuration: totalDuration,
      finalStatus: 'success'
    });

    return result;

  } catch (error) {
    // Enhanced error handling with full context
    const errorContext = {
      sessionId,
      currentStep,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        workingDirectory: process.cwd(),
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime()
      },
      configuration: {
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        hasSFPath: !!process.env.SF_CLI_PATH,
        nodeEnv: process.env.NODE_ENV || 'development'
      }
    };

    workflowLogger.logSession(sessionId, 'ERROR', 'Workflow execution failed', {
      step: currentStep,
      error: error.message,
      context: errorContext
    });

    // Re-throw with enhanced context
    const enhancedError = new Error(`Workflow failed at step '${currentStep}': ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.context = errorContext;
    enhancedError.sessionId = sessionId;
    enhancedError.step = currentStep;
    
    throw enhancedError;
  }
}

// Helper function to get workflow status
async function getWorkflowStatus(sessionId) {
  try {
    const recentLogs = workflowLogger.getRecentLogs('session', 100);
    const sessionLogs = recentLogs.filter(log => log.includes(sessionId));
    
    return {
      sessionId,
      logs: sessionLogs,
      status: sessionLogs.length > 0 ? 'found' : 'not_found'
    };
  } catch (error) {
    workflowLogger.error('Failed to get workflow status', {
      sessionId,
      error: error.message
    });
    return {
      sessionId,
      status: 'error',
      error: error.message
    };
  }
}

// Helper function to validate system prerequisites
function validateSystemPrerequisites() {
  const issues = [];
  const warnings = [];
  
  // Check required environment variables
  if (!process.env.OPENAI_API_KEY) {
    issues.push('OPENAI_API_KEY environment variable not set');
  }
  
  if (!process.env.SF_CLI_PATH) {
    warnings.push('SF_CLI_PATH not explicitly set, using default');
  }
  
  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
  if (majorVersion < 18) {
    warnings.push(`Node.js version ${nodeVersion} detected, recommend 18.0.0 or higher`);
  }
  
  // Check available memory
  const memoryUsage = process.memoryUsage();
  const availableMemory = memoryUsage.heapTotal + memoryUsage.external;
  if (availableMemory < 512 * 1024 * 1024) { // Less than 512MB
    warnings.push('Low available memory detected, large sites may fail');
  }
  
  return {
    valid: issues.length === 0,
    issues,
    warnings,
    summary: {
      nodeVersion,
      platform: process.platform,
      memoryUsage,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasSFPath: !!process.env.SF_CLI_PATH
    }
  };
}

// Check if run directly from CLI
if (require.main === module) {
  const inputData = { url: process.argv[2] };

  // Validate prerequisites first
  const prerequisites = validateSystemPrerequisites();
  if (!prerequisites.valid) {
    console.error('System prerequisites not met:');
    prerequisites.issues.forEach(issue => console.error(`  ❌ ${issue}`));
    prerequisites.warnings.forEach(warning => console.warn(`  ⚠️  ${warning}`));
    process.exit(1);
  }

  // Show warnings
  if (prerequisites.warnings.length > 0) {
    prerequisites.warnings.forEach(warning => console.warn(`⚠️  ${warning}`));
  }

  executeWorkflow(inputData)
    .then(result => {
      console.log('✅ Workflow completed successfully');
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Workflow execution failed:');
      console.error(`   Step: ${error.step || 'unknown'}`);
      console.error(`   Error: ${error.message}`);
      console.error(`   Session ID: ${error.sessionId || 'unknown'}`);
      
      if (error.context) {
        console.error('\n🔍 Context:');
        console.error(JSON.stringify(error.context, null, 2));
      }
      
      process.exit(1);
    });
}

module.exports = { 
  executeWorkflow, 
  getWorkflowStatus, 
  validateSystemPrerequisites 
};