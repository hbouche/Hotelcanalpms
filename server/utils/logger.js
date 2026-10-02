const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure log directory exists in the persistent database/uploads directory
const { LOGS_DIR: logDir, ensureDirectory } = require('../data-paths');
try {
  if (!fs.existsSync(logDir)) {
    ensureDirectory(logDir);
  }
} catch (e) {
  console.warn('⚠️ Could not create log directory:', e.message);
}

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// JSON formatting in production for log parsers; pretty colorized strings in development
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  process.env.NODE_ENV === 'production'
    ? winston.format.json()
    : winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.printf(
          (info) => `[${info.timestamp}] [${info.level}]: ${info.message}${info.stack ? `\n${info.stack}` : ''}`
        )
      )
);

const transports = [
  new winston.transports.Console()
];

// File logging only if directory creation was successful
if (fs.existsSync(logDir)) {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      options: { flags: 'a', mode: 0o600 },
      level: 'error',
      format: winston.format.combine(winston.format.uncolorize(), winston.format.json()),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      options: { flags: 'a', mode: 0o600 },
      format: winston.format.combine(winston.format.uncolorize(), winston.format.json()),
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels,
  format,
  transports,
});

module.exports = logger;
