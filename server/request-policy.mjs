import { isIP } from 'node:net';

const normalizeIp = value => String(value ?? '').replace(/^::ffff:/, '');
export function proxyHops(value) {
  if (value == null || value === '') return 0;
  if (!/^\d+$/.test(String(value)) || Number(value) > 16) throw new Error('Invalid TRUSTED_PROXY_HOPS');
  return Number(value);
}

/** A hop count alone is never permission to trust an arbitrary connecting peer. */
export function clientIp(req, hops = 0, peers = []) {
  const remote = normalizeIp(req.socket?.remoteAddress);
  if (!hops || !peers.map(normalizeIp).includes(remote)) return remote || 'unknown';
  const raw = req.headers['x-forwarded-for'];
  if (typeof raw !== 'string') return remote || 'unknown';
  const chain = raw.split(',').map(value => normalizeIp(value.trim()));
  if (chain.length < hops || chain.some(value => !isIP(value))) return remote || 'unknown';
  return chain[chain.length - hops];
}

export function corsHeaders(req, allowed = []) {
  const headers = { Vary: 'Origin', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Platform' };
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === 'null') return headers;
  try {
    const parsed = new URL(origin);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) return headers;
    if (parsed.host === req.headers.host || allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  } catch { /* malformed origins are not reflected */ }
  return headers;
}
