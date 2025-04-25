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

  getLogFilePath() {
    const date = new Date().toISOString().split('T')[0];
    return path.join(this.logDir, `workflow-${date}.log`);
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    const logLine = `[${timestamp}] [${level}] ${message}${data ? ' | Data: ' + JSON.stringify(data) : ''}
`;
    
    // Write to file
    fs.appendFileSync(this.getLogFilePath(), logLine);
    
    // Also log to console
    console.log(logLine.trim());
    
    return logEntry;
  }

  info(message, data = null) {
    return this.log('INFO', message, data);
  }

  error(message, data = null) {
    return this.log('ERROR', message, data);
  }

  debug(message, data = null) {
    return this.log('DEBUG', message, data);
  }
}

module.exports = new WorkflowLogger();