#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const client = read('src/systems/ScoreClient.ts');
const sfx = read('src/systems/Sfx.ts');
const botConfig = read('bot/config.mjs');
const botRuntime = read('bot/runtime.mjs');
const caddy = read('deploy/Caddyfile.ofeliya');
const nginx = read('deploy/nginx.conf');
const nginxContainerApps = read('deploy/nginx.containerapps.conf');
const nginxSecurityHeaders = read('deploy/nginx.security-headers.conf');
const dockerfile = read('deploy/Dockerfile');
const compose = read('deploy/compose.production.yml');
const runtimeConfig = read('public/runtime-config.js');
const serviceWorker = read('public/sw.js');
const envExample = read('deploy/ofeliya.env.example');
const deployScript = read('deploy/deploy-cloudru.sh');
const caddyRenderer = read('deploy/render-caddy-dedicated.sh');
const main = read('src/main.ts');
const deployWorkflow = read('.github/workflows/deploy-cloudru.yml');
const stampRelease = read('scripts/stamp-release.mjs');

const runtimePos = index.indexOf('./runtime-config.js');
const maxBridgePos = index.indexOf('https://st.max.ru/js/max-web-app.js');
assert.ok(runtimePos >= 0, 'index.html must load runtime-config.js');
assert.ok(maxBridgePos > runtimePos, 'release cache-buster must execute before MAX Bridge/app boot');

assert.match(
  client,
  /new URL\('api\/score', window\.location\.href\)/,
  'score API must resolve relative to the deployed Mini App prefix'
);
assert.doesNotMatch(main, /await retryPendingDailySubmission\(/, 'pending score replay must not block startup');
assert.ok(main.indexOf('await boot();') < main.lastIndexOf('retryPendingScores();'), 'pending score replay must begin after playable boot');

// Ofeliya and Hub are separate Mini Apps. Reusing /hub/* or HUB_* bot identity
// makes MAX open the Hub/old app even when the UI says OFELIYA.
assert.match(caddy, /handle_path \/ofeliya\/\*/, 'Caddy must strip /ofeliya/ before forwarding to static nginx');
assert.match(caddy, /path \/ofeliya\/runtime-config\.js/, 'Caddy must expose runtime config under /ofeliya/');
assert.doesNotMatch(caddy, /handle_path \/hub\/\*/, 'Ofeliya must not claim Hub production routes');
assert.doesNotMatch(botConfig, /HUB_|BOT_TOKEN\)\s*:\s*''/, 'Ofeliya bot config must not inherit Hub/Chatbot24 identity');
assert.doesNotMatch(botRuntime, /HUB_BOT_WEBHOOK_/, 'Ofeliya webhook config must not fall back to Hub settings');
assert.match(botRuntime, /OFELIYA_BOT_MODE must be dedicated/, 'production must reject shared bot ownership');
assert.match(botRuntime, /\/ofeliya\/bot\/webhook/, 'Ofeliya webhook path must be namespaced');

assert.match(nginx, /location \/api\/\s*\{[\s\S]*proxy_pass http:\/\/ofeliya-score:8787;/, 'nginx must proxy score API to score service');
assert.match(nginx, /location = \/api\/ref\s*\{[\s\S]*limit_except GET/, 'legacy unauthenticated referral writes must be blocked in production');
assert.match(nginx, /location \/audio\/\s*\{[\s\S]*max-age=31536000, immutable/, 'release-versioned audio must be immutable at nginx');
assert.match(nginxContainerApps, /location \/ofeliya\/audio\/\s*\{[\s\S]*max-age=31536000, immutable/, 'container app path must preserve immutable audio caching');
assert.match(sfx, /RELEASE_SHA/, 'audio requests must include immutable release identity');
assert.match(sfx, /audioAssetUrl\(MANIFEST\[name\]\.file\)/, 'SFX fetches must use the release-versioned URL helper');
assert.match(sfx, /audioAssetUrl\(track\)/, 'music fetches must use the release-versioned URL helper');
assert.match(dockerfile, /mkdir -p \/app\/server\/data && chown -R node:node \/app\/server/, 'score image must create a node-writable persistent data mountpoint');
assert.match(dockerfile, /CMD \["node", "server\/index\.mjs"\]/, 'score image must be runnable without a compose command override');
assert.match(dockerfile, /server\/telegram-share\.mjs/, 'score image must package Telegram share runtime module');
assert.match(dockerfile, /mkdir -p \/app\/certs && chown node:node \/app\/certs/, 'bot runtime must be able to traverse/read mounted CA directory');

assert.match(compose, /image: ofeliya-runtime:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'bot image must use an explicit immutable release tag');
assert.match(compose, /image: ofeliya-static:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'static image must use an explicit immutable release tag');
assert.match(compose, /image: ofeliya-score:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'score image must use an explicit immutable release tag');
assert.match(compose, /telegram-bot:[\s\S]*profiles: \["telegram"\]/, 'Telegram bot service must be opt-in via its own profile');
assert.match(compose, /image: ofeliya-telegram-bot:\$\{OFELIYA_RELEASE:\?OFELIYA_RELEASE is required\}/, 'Telegram bot image must use the immutable release tag');
assert.match(compose, /telegram-bot:[\s\S]*ofeliya-score-data:\/app\/server\/data/, 'Telegram bot must share the persistent referral/user data volume');
assert.match(compose, /telegram-bot:[\s\S]*TG_BOT_TOKEN: \$\{TG_BOT_TOKEN:-\}/, 'Telegram bot must receive only its dedicated token explicitly');
const telegramService = compose.match(/  telegram-bot:[\s\S]*?\n  static:/)?.[0] ?? '';
assert.doesNotMatch(telegramService, /env_file:/, 'Telegram bot must not inherit unrelated MAX secrets from the shared env file');
assert.match(dockerfile, /FROM node:22-alpine AS telegram-bot[\s\S]*server\/bot\.mjs/, 'Dockerfile must package the dedicated Telegram long-polling bot');
assert.match(compose, /OFELIYA_ENV_FILE:-\/opt\/ofeliya\/\.env/, 'production services must default to an Ofeliya-specific env file');
assert.doesNotMatch(compose, /\/opt\/hub|HUB_BOT_/, 'Ofeliya must not read Hub runtime secrets');
assert.match(compose, /VITE_MAX_BOT_USERNAME: \$\{OFELIYA_BOT_USERNAME:\?OFELIYA_BOT_USERNAME is required;/, 'client build must require an explicit Ofeliya bot username');
assert.match(compose, /MAX_BOT_TOKEN=.*\$\$OFELIYA_MAX_BOT_TOKEN/, 'score service must verify MAX initData with the app-specific Ofeliya token');
assert.match(compose, /OFELIYA_MAX_BOT_TOKEN: \$\{OFELIYA_MAX_BOT_TOKEN:-\}/, 'score container must receive the resolved verification token');
assert.match(
  deployScript,
  /OFELIYA_MAX_BOT_TOKEN="\$\{OFELIYA_MAX_BOT_TOKEN:-\$\{OFELIYA_BOT_TOKEN:-\}\}"/,
  'dedicated deployment may use its own bot token for MAX verification'
);
assert.match(deployScript, /OFELIYA_BOT_MODE:-dedicated/, 'dedicated bot ownership must be the deployment default');
assert.match(deployScript, /TELEGRAM_ENABLED=0/, 'Telegram production wiring must be explicitly gated');
assert.match(deployScript, /Telegram wiring incomplete: TG_BOT_TOKEN is missing/, 'Telegram deploy must fail closed without its token');
assert.match(deployScript, /Telegram wiring incomplete: VITE_TG_BOT_USERNAME is missing/, 'Telegram deploy must fail closed without its username');
assert.match(deployScript, /--profile telegram up -d telegram-bot/, 'Telegram deploy must start its dedicated service when configured');
assert.match(deployScript, /sync_caddy_edge\(\)/, 'deployment must synchronize the versioned Caddy edge policy');
assert.match(deployScript, /caddy validate/, 'edge config must be validated before activation');
assert.match(deployScript, /caddy reload/, 'validated edge config must be reloaded into the running Caddy service');
assert.match(deployScript, /restoring previous edge config/, 'failed Caddy reload must restore the previous edge config');
assert.match(caddyRenderer, /redir \/ \/ofeliya\/ 308/, 'dedicated renderer must preserve the canonical root redirect');

assert.doesNotMatch(deployScript, /HUB_BOT_|\/opt\/hub/, 'deployment must not inherit Hub/Chatbot24 identity');
assert.match(compose, /GAME_URL=.*\$\$OFELIYA_GAME_URL/, 'score service must publish Ofeliya links, not Hub links');
assert.match(compose, /ofeliya-score-data:\/app\/server\/data/, 'score store must stay on a named persistent volume');
assert.match(compose, /score:[\s\S]*healthcheck:[\s\S]*127\.0\.0\.1:8787\/health/, 'score service must expose a healthcheck');
assert.match(compose, /static:[\s\S]*depends_on:[\s\S]*score:[\s\S]*condition: service_healthy/, 'static nginx must wait for a healthy score service');
assert.match(compose, /external: true[\s\S]*OFELIYA_SHARED_NETWORK:\?OFELIYA_SHARED_NETWORK is required/, 'production services must require an explicitly configured Ofeliya network');

assert.match(envExample, /OFELIYA_BOT_TOKEN=/, 'production env template must require a dedicated Ofeliya token');
assert.match(envExample, /OFELIYA_MAX_BOT_TOKEN=/, 'production env template must require an app-specific MAX verification token');
assert.match(envExample, /OFELIYA_BOT_MODE=dedicated/, 'production env template must require dedicated bot ownership');
assert.match(envExample, /OFELIYA_BOT_USERNAME=id402806822924_5_bot/, 'production env template must identify the canonical MAX bot');
assert.match(envExample, /OFELIYA_GAME_URL=https:\/\/ofeliya\.freeveol\.dpdns\.org\/ofeliya\//, 'production env template must document the canonical Mini App URL');
assert.doesNotMatch(envExample, /\/opt\/hub|quiz\.chatbot24\.su/, 'production env template must not reference legacy Hub/Chatbot24 infrastructure');
assert.match(runtimeConfig, /const release = 'ofeliya-[^']+';/, 'runtime config must carry an explicit release id');
assert.match(serviceWorker, /const VERSION = 'ofeliya-__OFELIYA_RELEASE__';/, 'service worker cache must be unique to the immutable release');
assert.match(serviceWorker, /const CACHE_PREFIX = 'ofeliya-';/, 'service worker cache cleanup must be Ofeliya-scoped');
assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\) && !key\.startsWith\(VERSION\)/, 'service worker must not delete caches owned by other apps on the same origin');

assert.equal(
  (dockerfile.match(/ARG VITE_TELEGRAM_APP_SHORT_NAME=/g) ?? []).length,
  1,
  'Telegram build arg must be declared exactly once'
);
assert.match(
  stampRelease,
  /VITE_RELEASE_SHA must be an explicit 40-character git SHA/,
  'release stamping must fail closed without an immutable SHA'
);
assert.doesNotMatch(
  stampRelease,
  /VITE_RELEASE_SHA \|\| ['"]dev['"]/,
  'release stamping must not silently fall back to dev'
);
for (const marker of ['indexSha256', 'serviceWorkerSha256', 'runtimeConfigSha256']) {
  assert.match(stampRelease, new RegExp(marker), `release metadata must include ${marker}`);
}
assert.match(deployWorkflow, /Public HTTPS parity smoke/, 'deploy must run external parity verification');
assert.match(deployWorkflow, /sha256sum "\$tmp\/index\.html"/, 'deploy must hash live index.html');
assert.match(deployWorkflow, /sha256sum "\$tmp\/sw\.js"/, 'deploy must hash live service worker');
assert.match(deployWorkflow, /sha256sum "\$tmp\/runtime-config\.js"/, 'deploy must hash live runtime config');
assert.match(deployWorkflow, /strict-transport-security/, 'deploy must verify HSTS');
assert.match(
  deployWorkflow,
  /Require successful main CI for selected SHA[\s\S]*run\.event === 'push'[\s\S]*run\.conclusion === 'success'/,
  'manual deployment must still require a successful main push CI run'
);
assert.match(
  deployWorkflow,
  /Capture current production release for rollback[\s\S]*release\.json/,
  'deployment must capture the currently live immutable rollback SHA'
);
assert.match(
  deployWorkflow,
  /Roll back failed release[\s\S]*"deploy \$PREVIOUS_SHA"/,
  'failed rollout/parity must redeploy the captured previous SHA'
);
assert.match(
  deployWorkflow,
  /Verify rollback release[\s\S]*actual.*PREVIOUS_SHA/,
  'rollback must be externally verified before the failed workflow exits'
);
assert.match(
  deployWorkflow,
  /Fail deployment after rollback/,
  'rollback recovery must not turn a failed release green'
);
assert.match(caddy, /Strict-Transport-Security/, 'versioned edge config must enable HSTS');
for (const [name, source] of [
  ['nginx', nginx],
  ['container-apps nginx', nginxContainerApps],
]) {
  assert.match(source, /server_tokens off;/, `${name} must suppress server version disclosure`);
  const includes = source.match(/include \/etc\/nginx\/ofeliya-security-headers\.conf;/g) ?? [];
  assert.ok(includes.length >= 5, `${name} must apply shared security headers to all public surfaces`);
}
for (const marker of [
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Content-Security-Policy',
  'https://st.max.ru',
  'frame-ancestors',
]) {
  assert.match(
    nginxSecurityHeaders,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `shared nginx headers must include ${marker}`
  );
}
assert.match(nginxSecurityHeaders, /https:\/\/telegram\.org/, 'nginx CSP must allow the Telegram WebApp SDK');
assert.match(nginxSecurityHeaders, /https:\/\/web\.telegram\.org/, 'nginx frame-ancestors must allow Telegram Web');
assert.match(caddy, /https:\/\/telegram\.org/, 'edge CSP must allow the Telegram WebApp SDK');
assert.match(caddy, /https:\/\/web\.telegram\.org/, 'edge frame-ancestors must allow Telegram Web');

console.log('production deployment contract: ok');

[executed on device: chatgpt-ops-1 (ca22b74b-ed01-4519-b9df-03edbe57a1ba)]