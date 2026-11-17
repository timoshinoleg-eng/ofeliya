import { createHash } from 'node:crypto';

/** Hash the inline bootstrap shipped in the immutable HTML, never user input.
 * HTML parsing normalizes CRLF, so hash the same script text browsers execute.
 * Styles remain inline because Phaser and the legal overlay set styles at runtime.
 */
function httpsOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    // CSP origins are derived only from operator-controlled environment
    // configuration. Never allow http, credentials or injected directives.
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return url.origin;
  } catch { return ''; }
}

export function browserSecurityHeaders(html, {
  umamiEnabled = false, umamiSrc = '', paymentsApiUrl = '',
} = {}) {
  const umamiOrigin = umamiEnabled ? httpsOrigin(umamiSrc) : '';
  const paymentsOrigin = httpsOrigin(paymentsApiUrl);
  const scriptOrigins = [umamiOrigin].filter(Boolean).join(' ');
  const connectOrigins = [umamiOrigin, paymentsOrigin].filter(Boolean).join(' ');
  const hashes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(match[1]) || !match[2].trim()) continue;
    hashes.push(`'sha256-${createHash('sha256').update(match[2].replace(/\r\n?/g, '\n')).digest('base64')}'`);
  }
  return {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': [
      "default-src 'self'",
      `script-src 'self' ${hashes.join(' ')} https://st.max.ru https://telegram.org ${scriptOrigins}`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "media-src 'self' blob:", `connect-src 'self' https://st.max.ru https://telegram.org ${connectOrigins}`,
      "object-src 'none'", "base-uri 'none'", "form-action 'none'",
      "frame-ancestors 'self' https://*.max.ru https://web.max.ru https://web.telegram.org",
    ].join('; '),
  };
}
