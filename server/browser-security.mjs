import { createHash } from 'node:crypto';

/** Hash the inline bootstrap shipped in the immutable HTML, never user input.
 * HTML parsing normalizes CRLF, so hash the same script text browsers execute.
 * Styles remain inline because Phaser and the legal overlay set styles at runtime.
 */
export function browserSecurityHeaders(html) {
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
      `script-src 'self' ${hashes.join(' ')} https://st.max.ru https://telegram.org`,
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "media-src 'self' blob:", "connect-src 'self' https://st.max.ru https://telegram.org",
      "object-src 'none'", "base-uri 'none'", "form-action 'none'",
      "frame-ancestors 'self' https://*.max.ru https://web.max.ru https://web.telegram.org",
    ].join('; '),
  };
}
