// src/utils/workflowLogger.js - Enhanced with better logging structure
const fs = require('fs');
const path = require('path');

class WorkflowLogger {
  constructor(logDir = './logs/workflow') {
    this.logDir = logDir;
    this.ensureLogDirectory();
  }

  ensureLogDirectory() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  getLogFilePath(type = 'general') {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `${type}-${date}.log`);
  }

  log(level, message, data = null, logType = 'general') {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      pid: process.pid
    };

    // Create structured log line
    const logLine = this._formatLogLine(logEntry);
    
    // Write to appropriate log file
    const logFile = this.getLogFilePath(logType);
    fs.appendFileSync(logFile, logLine);
    
    // Also write to general log if it's not already general
    if (logType !== 'general') {
      const generalLogFile = this.getLogFilePath('general');
      fs.appendFileSync(generalLogFile, logLine);
    }
    
    // Console output with color coding
    this._consoleLog(level, message, data);
    
    return logEntry;
  }

  _formatLogLine(logEntry) {
    const { timestamp, level, message, data, pid } = logEntry;
    
    // Create a clean, parseable log line
    let logLine = `[${timestamp}] [${level}] [PID:${pid}] ${message}`;
    
    if (data) {
      // Format data based on its type
      if (typeof data === 'object') {
        try {
          // Pretty print for file logs, compact for console
          logLine += ` | Data: ${JSON.stringify(data, null, 2)}`;
        } catch (err) {
          logLine += ` | Data: [Object - stringify failed: ${err.message}]`;
        }
      } else {
        logLine += ` | Data: ${data}`;
      }
    }
    
    return logLine + '\n';
  }

  _consoleLog(level, message, data) {
    const timestamp = new Date().toISOString();
    const colors = {
      ERROR: '\x1b[31m',   // Red
      WARN: '\x1b[33m',    // Yellow
      INFO: '\x1b[36m',    // Cyan
      DEBUG: '\x1b[35m',   // Magenta
      RESET: '\x1b[0m'     // Reset
    };

    const color = colors[level] || colors.RESET;
    const reset = colors.RESET;
    
    let output = `${color}[${timestamp}] [${level}]${reset} ${message}`;
    
    if (data) {
      // Simplified data display for console
      if (typeof data === 'object') {
        try {
          const compact = JSON.stringify(data, null, 0);
          // Truncate very long data for console readability
          if (compact.length > 200) {
            output += ` | ${compact.substring(0, 197)}...`;
          } else {
            output += ` | ${compact}`;
          }
        } catch (err) {
          output += ` | [Object - ${err.message}]`;
        }
      } else {
        output += ` | ${data}`;
      }
    }
    
    console.log(output);
  }

  // Standard logging methods
  info(message, data = null) {
    return this.log('INFO', message, data);
  }

  error(message, data = null) {
    return this.log('ERROR', message, data);
  }

  warn(message, data = null) {
    return this.log('WARN', message, data);
  }

  debug(message, data = null) {
    return this.log('DEBUG', message, data);
  }

  // Specialized logging methods for different components
  crawlLog(level, message, data = null) {
    return this.log(level, message, data, 'crawler');
  }

  auditLog(level, message, data = null) {
    return this.log(level, message, data, 'audit');
  }

  apiLog(level, message, data = null) {
    return this.log(level, message, data, 'api');
  }

  // Method to log crawl progress specifically
  logCrawlProgress(url, status, details = {}) {
    const progressData = {
      url,
      status,
      timestamp: new Date().toISOString(),
      ...details
    };
    
    return this.crawlLog('INFO', `Crawl Progress: ${status}`, progressData);
  }

  // Method to log error with context
  logErrorWithContext(error, context = {}) {
    const errorData = {
      error: {
        message: error.message,
        stack: error.stack,
        code: error.code,
        signal: error.signal
      },
      context,
      timestamp: new Date().toISOString()
    };
    
    return this.log('ERROR', 'Error occurred with context', errorData);
  }

  // Method to create a session log for tracking entire workflows
  createSession(sessionId, metadata = {}) {
    const sessionData = {
      sessionId,
      started: new Date().toISOString(),
      metadata
    };
    
    return this.log('INFO', `Session started: ${sessionId}`, sessionData, 'session');
  }

  logSession(sessionId, level, message, data = null) {
    const sessionData = {
      sessionId,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    return this.log(level, `[${sessionId}] ${message}`, sessionData, 'session');
  }

  // Method to get recent logs (useful for debugging)
  getRecentLogs(type = 'general', lines = 50) {
    try {
      const logFile = this.getLogFilePath(type);
      if (!fs.existsSync(logFile)) {
        return [];
      }
      
      const content = fs.readFileSync(logFile, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      
      return allLines.slice(-lines);
    } catch (error) {
      this.error('Failed to read recent logs', { 
        type, 
        lines, 
        error: error.message 
      });
      return [];
    }
  }

  // Method to archive old logs
  archiveOldLogs(daysToKeep = 7) {
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      files.forEach(file => {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        
        if (stats.mtime < cutoffDate) {
          fs.unlinkSync(filePath);
          this.info('Archived old log file', { file, lastModified: stats.mtime });
        }
      });
    } catch (error) {
      this.error('Failed to archive old logs', { error: error.message });
    }
  }
}

module.exports = new WorkflowLogger();