import { createServer, request } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { once } from 'node:events';

const port = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 10000);
const apiPort = Number(process.env.OFELIYA_API_PORT ?? 8787);
if (process.env.RENDER === 'true' && (!process.env.OFELIYA_STATE_URL || !process.env.OFELIYA_STATE_TOKEN)) {
  throw new Error('Render requires durable state configuration');
}
if (port === apiPort) throw new Error('Public and internal API ports must differ');
process.env.PORT = String(apiPort);
const { server: api } = await import('./index.mjs');
if (!api.listening) await once(api, 'listening');
const root = await realpath(resolve(process.env.OFELIYA_DIST_DIR ?? 'dist'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

const gateway = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
      const proxy = request({ hostname: '127.0.0.1', port: apiPort, path: req.url,
        method: req.method, headers: { ...req.headers, host: 'localhost:' + apiPort } }, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
      });
      proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on('aborted', () => proxy.destroy()); req.pipe(proxy); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/' || url.pathname === '/ofeliya') {
      res.writeHead(302, { location: '/ofeliya/' + url.search }); res.end(); return;
    }
    let relative = decodeURIComponent(url.pathname).replace(/^\/ofeliya\//, '').replace(/^\//, '');
    if (!relative) relative = 'index.html';
    if (relative.split('/').some(part => part.startsWith('.')) || relative.includes('\\') || relative.includes('\0')) {
      res.writeHead(404); res.end(); return;
    }
    const file = await realpath(resolve(root, relative));
    if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); res.end(); return; }
    const extension = extname(file);
    res.writeHead(200, { 'content-type': mime[extension] ?? 'application/octet-stream',
      'content-length': info.size, 'x-content-type-options': 'nosniff',
      'cache-control': ['.html', '.json'].includes(extension) ? 'no-store'
        : relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=86400' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
gateway.listen(port, '0.0.0.0', () => console.log('[ofeliya-hosting] listening on ' + port));
process.once('SIGTERM', () => gateway.close());
process.once('SIGINT', () => gateway.close());
