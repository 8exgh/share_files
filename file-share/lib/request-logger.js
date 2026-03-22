const fs = require('fs');
const path = require('path');

const LOGS_DIR = process.env.LOGS_DIR || './logs';

let dirEnsured = false;

function ensureLogsDir() {
  if (!dirEnsured) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    dirEnsured = true;
  }
}

function getLogFilename() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}_${m}_${d}.txt`;
}

function sanitize(value) {
  if (!value || value === '-') return '-';
  return String(value).replace(/[\r\n\t]/g, ' ');
}

function formatTimestamp(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}.${ms}`;
}

function formatLogLine(data) {
  const parts = [
    formatTimestamp(data.timestamp),
    data.method || '-',
    data.statusCode || '-',
    data.duration != null ? data.duration + 'ms' : '-',
    sanitize(data.ip),
    data.url || '-',
    sanitize(data.userAgent),
    sanitize(data.referer),
    data.contentLength || '-',
  ];
  return parts.join('\t');
}

function appendToLog(line) {
  try {
    ensureLogsDir();
    const filePath = path.join(LOGS_DIR, getLogFilename());
    fs.appendFileSync(filePath, line + '\n');
  } catch (err) {
    console.error('[LOG] Failed to write log entry:', err.message);
  }
}

module.exports = { formatLogLine, appendToLog };
