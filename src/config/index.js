// src/config/index.js
require('dotenv').config();
const path = require('path');
const os = require('os');

// Determine if running on Windows
const isWindows = os.platform() === 'win32';

// Default paths based on platform
const defaultScreamingFrogPath = isWindows 
  ? 'C:\\Program Files\\Screaming Frog SEO Spider\\ScreamingFrogSEOSpiderCli.exe' 
  : './sf-crawler.sh';

module.exports = {
  paths: {
    exportsDir: process.env.EXPORTS_DIR || path.join(__dirname, '../../exports'),
    reportsDir: process.env.REPORTS_DIR || path.join(__dirname, '../../reports'),
    screamingFrogCli: process.env.SF_CLI_PATH || defaultScreamingFrogPath,
  },
  retries: {
    maxAttempts: parseInt(process.env.MAX_RETRIES) || 3,
    backoffMs: parseInt(process.env.RETRY_BACKOFF_MS) || 1000,
  },
  isWindows: isWindows
};