/**
 * Simple local static server for Voodoo Lottery.
 * Usage: node server.js
 * Opens http://localhost:8080/
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = path.join(__dirname, 'public');
const PREFERRED = 8080;
const MAX = 8090;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const clean = decoded.replace(/^\/+/, '').replace(/\\/g, '/');
  const full = path.normalize(path.join(root, clean || 'index.html'));
  if (!full.startsWith(root)) return null;
  return full;
}

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      let urlPath = req.url || '/';
      if (urlPath === '/') urlPath = '/index.html';

      const file = safeJoin(ROOT, urlPath);
      if (!file) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found: ' + urlPath);
          return;
        }
        const ext = path.extname(file).toLowerCase();
        res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') resolve(null);
      else reject(err);
    });

    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    console.error('ERROR: public/index.html not found at', ROOT);
    process.exit(1);
  }

  let server = null;
  let port = PREFERRED;
  for (; port <= MAX; port++) {
    server = await tryListen(port);
    if (server) break;
    console.log('Port', port, 'busy, trying next...');
  }

  if (!server) {
    console.error('ERROR: Could not bind any port', PREFERRED, '-', MAX);
    process.exit(1);
  }

  const url = `http://127.0.0.1:${port}/`;
  console.log('');
  console.log('  Voodoo Lottery is running');
  console.log('  Open EXACTLY this URL:', url);
  if (port !== PREFERRED) {
    console.log('  WARNING: Port', PREFERRED, 'was busy.');
  }
  console.log('');
  console.log('  Keep this window open. Press Ctrl+C to stop.');
  console.log('');

  // Open default browser
  const cmd =
    process.platform === 'win32'
      ? `start "" "${url}"`
      : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
