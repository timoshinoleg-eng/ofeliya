import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
assert.doesNotMatch(html, /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["'][^"']*\/shop-[^"']+\.js["']/i,
  'the payment-domain shop chunk must not be preloaded as an entry dependency');
const provider = readdirSync('dist/assets').find(name => /^TelegramStarsPaymentProvider-.*\.js$/.test(name));
assert.ok(provider, 'the payment provider must be emitted as its own dynamically loaded chunk');
assert.equal(html.includes(provider), false, 'the payment provider must not be preloaded in index.html');
console.log('lazy shop bundle: ok');
