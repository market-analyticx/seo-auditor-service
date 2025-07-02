const express = require('express');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const { executeWorkflow } = require('./scripts/run-workflow');
const workflowLogger = require('./src/utils/workflowLogger');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // For serving static files

// Webhook endpoint
app.post('/crawl-site', async (req, res) => {
  try {
    workflowLogger.info('Webhook received', { 
      body: req.body,
      headers: req.headers 
    });

    const result = await executeWorkflow(req.body);

    // Enhanced response with comprehensive results
    const response = {
      ...result,
      // Add metadata about the response
      meta: {
        processedAt: new Date().toISOString(),
        version: '2.0.0',
        hasResults: !!(result.auditResult && result.auditResult.results),
        dataStructure: {
          crawlResult: 'Basic crawl information',
          auditResult: 'Complete SEO analysis with structured data',
          results: 'Parsed and structured results for frontend consumption'
        }
      }
    };

    res.json(response);
  } catch (error) {
    workflowLogger.error('Webhook processing error', { 
      error: error.message,
      body: req.body 
    });

    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString(),
      meta: {
        version: '2.0.0',
        hasResults: false
      }
    });
  }
});

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'SEO Crawler Service is running',
    version: '2.0.0',
    endpoints: ['/crawl-site'],
    features: ['Crawling', 'AI Analysis', 'Comprehensive Results API']
  });
});

// Start the server
app.listen(port, () => {
  workflowLogger.info(`Server running on port ${port}`);
});