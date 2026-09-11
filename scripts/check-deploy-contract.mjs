#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const client = read('src/systems/ServerClient.ts');
const botConfig = read('bot/config.mjs');
const botRuntime = read('bot/runtime.mjs');
const caddy = read('deploy/Caddyfile.ofeliya');
const nginx = read('deploy/nginx.conf');
const dockerfile = read('deploy/Dockerfile');
const compose = read('deploy/compose.production.yml');
const runtimeConfig = read('public/runtime-config.js');
const serviceWorker = read('public/sw.js');

const runtimePos = index.indexOf('./runtime-config.js');
const maxBridgePos = index.indexOf('https://st.max.ru/js/max-web-app.js');
assert.ok(runtimePos >= 0, 'index.html must load runtime-config.js');
assert.ok(maxBridgePos > runtimePos, 'release cache-buster must execute before MAX Bridge/app boot');

assert.match(
  client,
  /new URL\(clean, document\.baseURI\)/,
  'score API must resolve relative to the deployed Mini App prefix'
);

// Ofeliya and Hub are separate Mini Apps. Reusing /hub/* or HUB_* bot identity
// makes MAX open the Hub/old app even when the UI says OFELIYA.
assert.match(caddy, /handle_path \/ofeliya\/\*/, 'Caddy must strip /ofeliya/ before forwarding to static nginx');
assert.match(caddy, /path \/ofeliya\/runtime-config\.js/, 'Caddy must expose runtime config under /ofeliya/');
assert.doesNotMatch(caddy, /handle_path \/hub\/\*/, 'Ofeliya must not claim Hub production routes');
assert.doesNotMatch(botConfig, /HUB_BOT_USERNAME/, 'Ofeliya bot config must not fall back to Hub username');
assert.doesNotMatch(botRuntime, /HUB_BOT_WEBHOOK_/, 'Ofeliya webhook config must not fall back to Hub settings');
assert.match(botRuntime, /\/ofeliya\/bot\/webhook/, 'Ofeliya webhook path must be namespaced');

assert.match(nginx, /location \/api\/\s*\{[\s\S]*proxy_pass http:\/\/ofeliya-score:8787;/, 'nginx must proxy score API to score service');
assert.match(nginx, /location = \/api\/ref\s*\{[\s\S]*limit_except GET/, 'legacy unauthenticated referral writes must be blocked in production');
assert.match(dockerfile, /mkdir -p \/app\/server\/data && chown -R node:node \/app\/server/, 'score image must create a node-writable persistent data mountpoint');
assert.match(dockerfile, /CMD \["node", "server\/index\.mjs"\]/, 'score image must be runnable without a compose command override');
assert.match(dockerfile, /mkdir -p \/app\/certs && chown node:node \/app\/certs/, 'bot runtime must be able to traverse/read mounted CA directory');

assert.match(compose, /image: ofeliya-runtime:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'bot image must use an explicit immutable release tag');
assert.match(compose, /image: ofeliya-static:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'static image must use an explicit immutable release tag');
assert.match(compose, /image: ofeliya-score:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'score image must use an explicit immutable release tag');
assert.match(compose, /BOT_TOKEN: \$\{OFELIYA_BOT_TOKEN:\?OFELIYA_BOT_TOKEN is required\}/, 'bot container must receive the Ofeliya token explicitly');
assert.match(compose, /OFELIYA_BOT_USERNAME: \$\{OFELIYA_BOT_USERNAME:\?OFELIYA_BOT_USERNAME is required\}/, 'bot container must receive the Ofeliya username explicitly');
assert.match(compose, /MAX_BOT_TOKEN: \$\{OFELIYA_BOT_TOKEN:\?OFELIYA_BOT_TOKEN is required\}/, 'score service must verify MAX initData with the Ofeliya token');
assert.match(compose, /VITE_MAX_BOT_USERNAME: \$\{OFELIYA_BOT_USERNAME:\?OFELIYA_BOT_USERNAME is required\}/, 'client deep links must target the Ofeliya bot');
assert.match(compose, /ofeliya-score-data:\/app\/server\/data/, 'score store must stay on a named persistent volume');
assert.match(compose, /score:[\s\S]*healthcheck:[\s\S]*127\.0\.0\.1:8787\/health/, 'score service must expose a healthcheck');
assert.match(compose, /static:[\s\S]*depends_on:[\s\S]*score:[\s\S]*condition: service_healthy/, 'static nginx must wait for a healthy score service');
assert.match(compose, /external: true[\s\S]*HUB_SHARED_NETWORK:-quiz-battle_default/, 'production services must join the shared external network explicitly');

assert.match(runtimeConfig, /const release = 'ofeliya-[^']+';/, 'runtime config must carry an explicit release id');
assert.match(serviceWorker, /const VERSION = 'ofeliya-v041-r2';/, 'service worker cache must rotate with the routing hotfix');

console.log('production deployment contract: ok');
