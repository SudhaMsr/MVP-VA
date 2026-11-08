// A tiny static server for docs/, for the headless checks in tools/ (no dependencies).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.css': 'text/css' };

export function serve(root) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(path.resolve(root))) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (e, b) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': 'no-cache' });
      res.end(b);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ url: `http://localhost:${srv.address().port}/`, close: () => srv.close() })));
}
