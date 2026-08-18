// Zero-dependency static server for the AQMath SPA.
//
// Serves the aqmath-ui directory and, for any extensionless path that has no
// matching file (e.g. /app, /backtest), falls back to index.html — mirroring the
// production clean-URL behaviour (GitHub Pages 404 bounce) so the SPA router in
// app.js resolves the route from window.location.pathname.
//
// Used by playwright.config.cjs as the test `webServer`. Port via PORT env.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function end(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

function serveIndex(res) {
  fs.readFile(path.join(ROOT, 'index.html'), (err, buf) => {
    if (err) return end(res, 404, 'Not found');
    end(res, 200, buf, MIME['.html']);
  });
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch (e) {
    return end(res, 400, 'Bad request');
  }

  let rel = urlPath.replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';

  const filePath = path.join(ROOT, rel);
  // Block path traversal outside ROOT.
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    return end(res, 403, 'Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isFile()) return serveFile(filePath, res);
    // SPA fallback for extensionless routes (clean URLs): mirror the production
    // Caddy `try_files {path} {path}.html ... /index.html` — a clean URL whose
    // entry page exists (/docs -> docs.html) must serve that page, not
    // index.html. index.html only ships the landing view, so routing /docs
    // through it left the body on route-landing.
    if (!path.extname(filePath)) {
      return fs.stat(filePath + '.html', (errHtml, statHtml) => {
        if (!errHtml && statHtml.isFile()) return serveFile(filePath + '.html', res);
        return serveIndex(res);
      });
    }
    return end(res, 404, 'Not found');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`static-server: http://127.0.0.1:${PORT} (root: ${ROOT})`);
});
