const http = require('http');
const { formatLogLine, appendToLog } = require('./lib/request-logger');

const originalCreateServer = http.createServer;

http.createServer = function patchedCreateServer(...args) {
  const listenerIndex = args.findIndex(a => typeof a === 'function');

  if (listenerIndex !== -1) {
    const originalListener = args[listenerIndex];
    args[listenerIndex] = function loggingListener(req, res) {
      const startTime = Date.now();

      res.on('finish', () => {
        const duration = Date.now() - startTime;
        const forwarded = req.headers['x-forwarded-for'];
        const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null)
          || req.headers['x-real-ip']
          || req.socket?.remoteAddress
          || '-';

        const line = formatLogLine({
          timestamp: new Date(startTime),
          method: req.method,
          statusCode: res.statusCode,
          duration,
          ip,
          url: req.url,
          userAgent: req.headers['user-agent'] || '-',
          referer: req.headers['referer'] || '-',
          contentLength: res.getHeader('content-length') || '-',
        });
        appendToLog(line);
      });

      return originalListener.call(this, req, res);
    };
  }

  return originalCreateServer.apply(this, args);
};

// Boot the Next.js standalone server (uses the patched http.createServer)
require('./server.js');
