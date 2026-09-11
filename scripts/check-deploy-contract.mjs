#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const client = read('src/systems/ServerClient.ts');
const caddy = read('deploy/Caddyfile.ofeliya');
const nginx = read('deploy/nginx.conf');
const dockerfile = read('deploy/Dockerfile');
const compose = read('deploy/compose.production.yml');
const server = read('server/index.mjs');
const runtimeConfig = read('public/runtime-config.js');

const runtimePos = index.indexOf('./runtime-config.js');
const maxBridgePos = index.indexOf('https://st.max.ru/js/max-web-app.js');
assert.ok(runtimePos >= 0, 'index.html must load runtime-config.js');
assert.ok(maxBridgePos > runtimePos, 'release cache-buster must execute before MAX Bridge/app boot');

assert.match(
  client,
  /new URL\(clean, document\.baseURI\)/,
  'score API must resolve relative to the deployed Mini App prefix'
);
assert.match(caddy, /handle_path \/hub\/\*/, 'Caddy must strip /hub/ before forwarding to static nginx');
assert.match(caddy, /path \/hub\/runtime-config\.js/, 'Caddy must expose the no-cache runtime config under /hub/');
assert.match(nginx, /location \/api\/\s*\{[\s\S]*proxy_pass http:\/\/ofeliya-score:8787;/, 'nginx must proxy score API to score service');
assert.match(nginx, /location = \/api\/ref\s*\{[\s\S]*limit_except GET/, 'legacy unauthenticated referral writes must be blocked in production');
assert.match(dockerfile, /mkdir -p \/app\/server\/data && chown -R node:node \/app\/server/, 'score image must create a node-writable persistent data mountpoint');
assert.match(dockerfile, /CMD \["node", "server\/index\.mjs"\]/, 'score image must be runnable without a compose command override');
assert.match(dockerfile, /mkdir -p \/app\/certs && chown node:node \/app\/certs/, 'bot runtime must be able to traverse/read mounted CA directory');

assert.match(compose, /image: ofeliya-runtime:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'bot image must use an explicit immutable release tag');
assert.match(compose, /image: ofeliya-static:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'static image must use an explicit immutable release tag');
assert.match(compose, /image: ofeliya-score:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'score image must use an explicit immutable release tag');
assert.match(compose, /ofeliya-score-data:\/app\/server\/data/, 'score store must stay on a named persistent volume');
assert.match(compose, /score:[\s\S]*healthcheck:[\s\S]*127\.0\.0\.1:8787\/health/, 'score service must expose a healthcheck');
assert.match(compose, /static:[\s\S]*depends_on:[\s\S]*score:[\s\S]*condition: service_healthy/, 'static nginx must wait for a healthy score service');
assert.match(compose, /external: true[\s\S]*HUB_SHARED_NETWORK:-quiz-battle_default/, 'production services must join the shared external network explicitly');

assert.match(server, /MAX_BOT_TOKEN \|\| process\.env\.BOT_TOKEN/, 'score service must accept the existing production BOT_TOKEN fallback');
assert.match(server, /minWinTimeMs:\s*300_000/, 'server must reject wins before the 5:00 boss spawn');
assert.match(runtimeConfig, /const release = 'ofeliya-[^']+';/, 'runtime config must carry an explicit release id');

console.log('production deployment contract: ok');
