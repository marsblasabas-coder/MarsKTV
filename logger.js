const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, 'ktv_system.log');

function logEvent(type, details) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${type.toUpperCase()}] ${JSON.stringify(details)}\n`;

  console.log(logEntry.trim());

  fs.appendFile(logFilePath, logEntry, (err) => {
    if (err) console.error('Failed to write log:', err);
  });
}

module.exports = logEvent;