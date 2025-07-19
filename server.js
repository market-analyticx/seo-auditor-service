// server.js - Updated with report management endpoints
const express = require('express');
const dotenv = require('dotenv');
const bodyParser = require('body-parser');
const path = require('path');
const { executeWorkflow } = require('./scripts/run-workflow');
const workflowLogger = require('./src/utils/workflowLogger');
const auditController = require('./src/controllers/auditController');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); // For serving static files

// Main webhook endpoint (existing functionality)
app.post('/crawl-site', async (req, res) => {
  try {
    workflowLogger.info('Webhook received', { 
      body: req.body,
      headers: req.headers 
    });

    const result = await executeWorkflow(req.body);

    // Enhanced response with comprehensive results and organized structure info
    const response = {
      ...result,
      // Add metadata about the response and organized structure
      meta: {
        processedAt: new Date().toISOString(),
        version: '2.0.0',
        hasResults: !!(result.auditResult && result.auditResult.results),
        dataStructure: {
          crawlResult: 'Basic crawl information',
          auditResult: 'Complete SEO analysis with structured data',
          results: 'Parsed and structured results for frontend consumption'
        },
        organizationInfo: {
          reportsStructure: 'reports/slug/timestamp/',
          description: 'Reports are now organized in hierarchical folders by website and analysis date'
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

// NEW: Get all analysis sessions for a website
app.get('/analysis-sessions/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    
    workflowLogger.info('Listing analysis sessions', { slug });
    
    const sessions = await auditController.listAnalysisSessions(slug);
    
    res.json({
      status: 'success',
      slug: slug,
      sessionCount: sessions.sessionCount,
      sessions: sessions.sessions,
      meta: {
        version: '2.0.0',
        endpoint: 'analysis-sessions',
        organization: 'reports/slug/timestamp/'
      }
    });
    
  } catch (error) {
    workflowLogger.error('Failed to list analysis sessions', {
      slug: req.params.slug,
      error: error.message
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      slug: req.params.slug
    });
  }
});

// NEW: Get specific analysis session details
app.get('/analysis-session/:slug/:timestamp', async (req, res) => {
  try {
    const { slug, timestamp } = req.params;
    
    workflowLogger.info('Retrieving analysis session', { slug, timestamp });
    
    const session = await auditController.getAnalysisSession(slug, timestamp);
    
    if (!session.available) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Analysis session not found',
        slug: slug,
        timestamp: timestamp
      });
    }
    
    res.json({
      status: 'success',
      session: session,
      meta: {
        version: '2.0.0',
        endpoint: 'analysis-session',
        organization: 'reports/slug/timestamp/'
      }
    });
    
  } catch (error) {
    workflowLogger.error('Failed to retrieve analysis session', {
      slug: req.params.slug,
      timestamp: req.params.timestamp,
      error: error.message
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message,
      slug: req.params.slug,
      timestamp: req.params.timestamp
    });
  }
});

// NEW: Download report files from organized structure
app.get('/download-report/:slug/:timestamp/:reportType', async (req, res) => {
  try {
    const { slug, timestamp, reportType } = req.params;
    
    workflowLogger.info('Download report request', { slug, timestamp, reportType });
    
    const session = await auditController.getAnalysisSession(slug, timestamp);
    
    if (!session.available) {
      return res.status(404).json({
        status: 'not_found',
        message: 'Analysis session not found'
      });
    }
    
    let filePath;
    let filename;
    let contentType = 'text/plain';
    
    switch (reportType) {
      case 'comprehensive':
        filePath = session.reports.files.comprehensive;
        filename = `${slug}_comprehensive_analysis_${timestamp}.txt`;
        contentType = 'text/plain';
        break;
        
      case 'executive':
        filePath = session.reports.files.executive;
        filename = `${slug}_executive_summary_${timestamp}.md`;
        contentType = 'text/markdown';
        break;
        
      case 'per-page-summary':
        filePath = session.reports.files.perPageSummary;
        filename = `${slug}_per_page_summary_${timestamp}.md`;
        contentType = 'text/markdown';
        break;
        
      case 'action-plan':
        filePath = session.reports.files.actionPlan;
        filename = `${slug}_action_plan_${timestamp}.md`;
        contentType = 'text/markdown';
        break;
        
      default:
        return res.status(400).json({
          status: 'error',
          message: 'Invalid report type. Available types: comprehensive, executive, per-page-summary, action-plan'
        });
    }
    
    if (!filePath) {
      return res.status(404).json({
        status: 'not_found',
        message: `Report type '${reportType}' not found for this session`
      });
    }
    
    // Set headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Send file
    res.sendFile(path.resolve(filePath), (err) => {
      if (err) {
        workflowLogger.error('File download error', {
          slug, timestamp, reportType, filePath, error: err.message
        });
        
        if (!res.headersSent) {
          res.status(500).json({
            status: 'error',
            message: 'Failed to download file'
          });
        }
      } else {
        workflowLogger.info('File downloaded successfully', {
          slug, timestamp, reportType, filename
        });
      }
    });
    
  } catch (error) {
    workflowLogger.error('Download report error', {
      slug: req.params.slug,
      timestamp: req.params.timestamp,
      reportType: req.params.reportType,
      error: error.message
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// NEW: Get organization overview - useful for understanding the structure
app.get('/organization-overview', async (req, res) => {
  try {
    const fs = require('fs').promises;
    const config = require('./src/config');
    
    const reportsDir = config.paths.reportsDir || path.join(__dirname, 'reports');
    
    // Get overview of all organized reports
    const overview = {
      structure: 'reports/slug/timestamp/',
      description: 'Hierarchical organization by website slug and analysis timestamp',
      baseDirectory: reportsDir,
      websites: []
    };
    
    try {
      const slugDirs = await fs.readdir(reportsDir, { withFileTypes: true });
      
      for (const slugEntry of slugDirs) {
        if (slugEntry.isDirectory()) {
          const slugPath = path.join(reportsDir, slugEntry.name);
          const sessionDirs = await fs.readdir(slugPath, { withFileTypes: true });
          
          const sessions = [];
          for (const sessionEntry of sessionDirs) {
            if (sessionEntry.isDirectory()) {
              const sessionPath = path.join(slugPath, sessionEntry.name);
              const files = await fs.readdir(sessionPath);
              
              sessions.push({
                timestamp: sessionEntry.name,
                fileCount: files.length,
                hasPerPageAnalysis: files.includes('per_page_analysis')
              });
            }
          }
          
          overview.websites.push({
            slug: slugEntry.name,
            sessionCount: sessions.length,
            sessions: sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp)) // Latest first
          });
        }
      }
    } catch (dirError) {
      // Reports directory might not exist yet
      overview.note = 'Reports directory not found or empty';
    }
    
    res.json({
      status: 'success',
      organization: overview,
      meta: {
        version: '2.0.0',
        endpoint: 'organization-overview'
      }
    });
    
  } catch (error) {
    workflowLogger.error('Organization overview error', {
      error: error.message
    });
    
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Health check route (enhanced with organization info)
app.get('/', (req, res) => {
  res.json({
    status: 'SEO Crawler Service is running',
    version: '2.0.0',
    endpoints: [
      '/crawl-site (POST) - Main analysis endpoint',
      '/analysis-sessions/:slug (GET) - List all sessions for a website', 
      '/analysis-session/:slug/:timestamp (GET) - Get specific session details',
      '/download-report/:slug/:timestamp/:reportType (GET) - Download report files',
      '/organization-overview (GET) - View report organization structure'
    ],
    features: [
      'Crawling', 
      'AI Analysis', 
      'Comprehensive Results API',
      'Organized Report Structure (reports/slug/timestamp/)',
      'Per-page Analysis',
      'Executive Summaries',
      'Report Management'
    ],
    reportStructure: {
      organization: 'reports/slug/timestamp/',
      description: 'Reports are organized hierarchically by website and analysis date',
      files: {
        comprehensive: 'comprehensive_analysis.txt',
        executive: 'executive_summary.md',
        perPageDirectory: 'per_page_analysis/',
        individualPages: 'page_001_*.md, page_002_*.md, ...',
        summaries: 'per_page_analysis_summary.md, priority_action_plan.md'
      }
    }
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  workflowLogger.error('Unhandled server error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    status: 'error',
    message: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Start the server
app.listen(port, () => {
  workflowLogger.info(`SEO Auditor Service v2.0 running on port ${port}`);
  workflowLogger.info('Report organization enabled', {
    structure: 'reports/slug/timestamp/',
    features: ['Organized folders', 'Session management', 'Report downloads']
  });
});