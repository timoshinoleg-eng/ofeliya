import { createServer, request } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath, readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { once } from 'node:events';
import { createHostedMaxWebhook } from '../bot/hosting.mjs';
import { browserSecurityHeaders } from './browser-security.mjs';
import { proxyHops, clientIp } from './request-policy.mjs';

const port = Number(process.env.SERVER_PORT ?? process.env.PORT ?? 10000);
const apiPort = Number(process.env.OFELIYA_API_PORT ?? 8787);
if (process.env.RENDER === 'true' && (!process.env.OFELIYA_STATE_URL || !process.env.OFELIYA_STATE_TOKEN)) {
  throw new Error('Render requires durable state configuration');
}
if (port === apiPort) throw new Error('Public and internal API ports must differ');
process.env.PORT = String(apiPort);
// The internal API is reachable only through this process. Public forwarding
// headers are replaced, never blindly copied into a trusted internal chain.
process.env.API_HOST = '127.0.0.1';
process.env.TRUSTED_PROXY_HOPS ??= '1';
process.env.TRUSTED_PROXY_IPS = '127.0.0.1';
const publicProxyHops = proxyHops(process.env.HOST_TRUSTED_PROXY_HOPS);
const publicProxyIps = String(process.env.HOST_TRUSTED_PROXY_IPS ?? '').split(',').map(value => value.trim()).filter(Boolean);
if (!process.env.MAX_BOT_TOKEN && process.env.OFELIYA_BOT_TOKEN) {
  process.env.MAX_BOT_TOKEN = process.env.OFELIYA_MAX_BOT_TOKEN || process.env.OFELIYA_BOT_TOKEN;
}
let maxWebhook = null;
const maxConfigured = Boolean(String(process.env.OFELIYA_BOT_TOKEN || '').trim());
let maxState = maxConfigured ? 'configured' : 'disabled';
try { maxWebhook = createHostedMaxWebhook(); }
catch { maxState = 'failed'; console.error('[ofeliya-hosting] MAX webhook configuration failed'); }
const { server: api } = await import('./index.mjs');
if (!api.listening) await once(api, 'listening');
const root = await realpath(resolve(process.env.OFELIYA_DIST_DIR ?? 'dist'));
const securityHeaders = browserSecurityHeaders(await readFile(resolve(root, 'index.html'), 'utf8'));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };

const gateway = createServer(async (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/ready' && ['GET', 'HEAD'].includes(req.method)) {
      const telegramConfigured = Boolean(String(process.env.TG_BOT_TOKEN || '').trim());
      const telegramReady = !telegramConfigured || String(process.env.TG_WEBHOOK_SECRET || '').length >= 16;
      const integrations = {
        max: { required: maxConfigured, state: maxState },
        telegram: { required: telegramConfigured, state: telegramConfigured ? telegramReady ? 'configured' : 'failed' : 'disabled' },
      };
      let apiReady = false;
      try {
        const health = await fetch(`http://127.0.0.1:${apiPort}/health`, { signal: AbortSignal.timeout(2500) });
        apiReady = health.ok && (await health.json()).ok === true;
      } catch { /* readiness must fail closed when the API cannot answer */ }
      const ready = apiReady && maxState !== 'failed' && telegramReady;
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: ready, api: apiReady, integrations }));
      return;
    }
    if (url.pathname === '/ofeliya/bot/webhook') {
      if (!maxWebhook) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'MAX webhook is not configured' }));
      } else maxWebhook(req, res);
      return;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ofeliya/api/') || url.pathname === '/health') {
      const apiPath = url.pathname.startsWith('/ofeliya/api/') ? req.url.slice('/ofeliya'.length) : req.url;
      const proxy = request({ hostname: '127.0.0.1', port: apiPort, path: apiPath,
        method: req.method, headers: { ...req.headers, 'x-forwarded-for': clientIp(req, publicProxyHops, publicProxyIps) } }, upstream => {
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
