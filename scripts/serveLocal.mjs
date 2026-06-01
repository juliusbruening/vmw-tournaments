// scripts/serveLocal.mjs
// Mini-Static-Server für /public auf http://localhost:5173
// Mappt /api/data → public/data.json, damit das Frontend ohne Netlify-Functions lokal läuft.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  try {
    let url = req.url.split('?')[0];

    if (url === '/api/data') url = '/data.json';
    if (url === '/') url = '/index.html';

    const file = join(PUBLIC, url);
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(buf);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
});

server.listen(PORT, () => console.log(`[serveLocal] http://localhost:${PORT}`));
