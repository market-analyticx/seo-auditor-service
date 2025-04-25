// src/config/index.js
require('dotenv').config();
const path = require('path');

module.exports = {
  paths: {
    exportsDir: process.env.EXPORTS_DIR || path.join(__dirname, '../../exports'),
    reportsDir: process.env.REPORTS_DIR || path.join(__dirname, '../../reports'),
    screamingFrogCli: process.env.SF_CLI_PATH || 'ScreamingFrogSEOSpiderCli',
  },
  retries: {
    maxAttempts: parseInt(process.env.MAX_RETRIES) || 3,
    backoffMs: parseInt(process.env.RETRY_BACKOFF_MS) || 1000,
  },
};