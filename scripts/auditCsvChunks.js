// scripts/auditCsvChunks.js
require('dotenv').config();
const auditController = require('../src/controllers/auditController');
const workflowLogger = require('../src/utils/workflowLogger');

// CLI interface
if (require.main === module) {
  const slug = process.argv[2];

  if (!slug) {
    console.error('❌ Please provide a slug as the first argument.');
    workflowLogger.error('No slug provided for audit');
    process.exit(1);
  }

  // Check if API key is available
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is not set in .env file');
    workflowLogger.error('OPENAI_API_KEY not configured');
    process.exit(1);
  }

  workflowLogger.info('Starting audit via CLI', { slug });

  auditController.analyzeWebsite(slug)
    .then(result => {
      console.log('🎉 Complete SEO analysis saved to:', result.reportPath);
      workflowLogger.info('Audit completed via CLI', { 
        slug, 
        reportPath: result.reportPath,
        duration: result.duration 
      });
      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Failed to process CSV:', error.message);
      workflowLogger.error('Audit failed via CLI', { 
        slug, 
        error: error.message 
      });
      process.exit(1);
    });
}

module.exports = { auditController };