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

// Webhook endpoint
app.post('/crawl-site', async (req, res) => {
  try {
    workflowLogger.info('Webhook received', { 
      body: req.body,
      headers: req.headers 
    });

    const result = await executeWorkflow(req.body);

    res.json(result);
  } catch (error) {
    workflowLogger.error('Webhook processing error', { 
      error: error.message,
      body: req.body 
    });

    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'SEO Crawler Service is running',
    version: '2.0.0',
    endpoints: ['/crawl-site']
  });
});

// Start the server
app.listen(port, () => {
  workflowLogger.info(`Server running on port ${port}`);
});