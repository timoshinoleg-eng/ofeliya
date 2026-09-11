#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const main = read('src/main.ts');
const botConfig = read('bot/config.mjs');
const botRuntime = read('bot/runtime.mjs');
const caddy = read('deploy/Caddyfile.ofeliya');
const compose = read('deploy/compose.production.yml');
const dockerfile = read('deploy/Dockerfile');
const nginx = read('deploy/nginx.conf');
const runtimeConfig = read('public/runtime-config.js');
const serviceWorker = read('public/sw.js');

const runtimePos = index.indexOf('./runtime-config.js');
const maxBridgePos = index.indexOf('https://st.max.ru/js/max-web-app.js');
assert.ok(runtimePos >= 0, 'index must load runtime-config.js');
assert.ok(maxBridgePos > runtimePos, 'cache-buster must run before MAX Bridge');
assert.match(index, /OFELIYA: STRAIN ZERO/, 'release document must identify Strain Zero');
assert.match(main, /type:\s*Phaser\.CANVAS/, 'MAX RC must use Canvas startup fallback');
assert.match(main, /FONT_READY_TIMEOUT_MS\s*=\s*700/, 'font loading must not block MAX startup indefinitely');
assert.match(caddy, /handle_path \/ofeliya\/\*/, 'Ofeliya must own /ofeliya/ namespace');
assert.doesNotMatch(caddy, /handle_path \/hub\/\*/, 'Ofeliya must not claim Hub routes');
assert.doesNotMatch(botConfig, /HUB_BOT_USERNAME/, 'bot identity must never fall back to Hub');
assert.doesNotMatch(botRuntime, /HUB_BOT_WEBHOOK_/, 'webhook config must never fall back to Hub');
assert.match(botRuntime, /\/ofeliya\/bot\/webhook/, 'webhook must use Ofeliya namespace');
assert.match(compose, /OFELIYA_ENV_FILE:-\/opt\/ofeliya\/\.env/, 'compose must use isolated Ofeliya env');
assert.match(compose, /VITE_MAX_BOT_NAME:\s*\$\{OFELIYA_BOT_USERNAME:\?/, 'Strain Zero bot name must be injected at build time');
assert.match(compose, /VITE_DEVELOPER_LEGAL_NAME:\s*\$\{OFELIYA_DEVELOPER_LEGAL_NAME:\?/, 'legal name must be required for production static build');
assert.match(compose, /VITE_DEVELOPER_REGISTRATION:\s*\$\{OFELIYA_DEVELOPER_REGISTRATION:\?/, 'registration must be required for production static build');
assert.match(compose, /VITE_DEVELOPER_ADDRESS:\s*\$\{OFELIYA_DEVELOPER_ADDRESS:\?/, 'developer address must be required for production static build');
assert.match(compose, /VITE_SUPPORT_EMAIL:\s*\$\{OFELIYA_SUPPORT_EMAIL:\?/, 'support email must be required for production static build');
assert.match(dockerfile, /ARG VITE_MAX_BOT_NAME/, 'Dockerfile must accept the Strain Zero MAX bot name');
assert.match(dockerfile, /ARG VITE_DEVELOPER_LEGAL_NAME/, 'Dockerfile must accept legal release metadata');
assert.match(dockerfile, /RUN npm run build:max/, 'production image must execute the MAX release gate');
assert.match(nginx, /location = \/runtime-config\.js[\s\S]*no-store/, 'runtime config must be no-store');
assert.match(runtimeConfig, /ofeliya-20260911-strain-zero-rc1/, 'MAX WebView URL key must identify this RC');
assert.match(serviceWorker, /ofeliya-strain-zero-rc1/, 'service worker cache must identify this RC');
assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\)/, 'cache cleanup must be scoped to Ofeliya');

console.log('Strain Zero production release contract: ok');
