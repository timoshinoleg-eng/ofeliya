#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const index = read('index.html');
const main = read('src/main.ts');
const botConfig = read('bot/config.mjs');
const botRuntime = read('bot/runtime.mjs');
const maxPlatform = read('src/platform/MaxPlatform.ts');
const caddy = read('deploy/Caddyfile.ofeliya');
const compose = read('deploy/compose.production.yml');
const deployScript = read('deploy/deploy-cloudru.sh');
const envExample = read('deploy/ofeliya.env.example');
const dockerfile = read('deploy/Dockerfile');
const nginx = read('deploy/nginx.conf');
const runtimeConfig = read('public/runtime-config.js');
const serviceWorker = read('public/sw.js');
const releaseSource = read('src/release.ts');
const releaseStamp = read('scripts/stamp-release.mjs');
const deployWorkflow = read('.github/workflows/deploy-cloudru.yml');

const runtimePos = index.indexOf('./runtime-config.js');
const maxBridgePos = index.indexOf('https://st.max.ru/js/max-web-app.js');
assert.ok(runtimePos >= 0, 'index must load runtime-config.js');
assert.ok(maxBridgePos > runtimePos, 'runtime config must run before MAX Bridge');
assert.match(index, /OFELIYA: STRAIN ZERO/, 'release document must identify Strain Zero');
assert.match(index, /ofeliya-strain-zero-main-qa[.]onrender[.]com/, 'legacy Render host must be detected');
assert.match(index, /https:\/\/ofeliya[.]freeveol[.]dpdns[.]org\/ofeliya\//, 'legacy Render launch must move to canonical Ofeliya production');
assert.doesNotMatch(index, /quiz[.]chatbot24[.]su/, 'Ofeliya launch HTML must not reference the retired Chatbot24 host');
assert.match(index, /target[.]hash = window[.]location[.]hash/, 'Render cutover must preserve MAX WebAppData fragment');
assert.match(
  main,
  /return webGLPreflight\(\) \? Phaser\.WEBGL : Phaser\.CANVAS/,
  'MAX RC must prefer WebGL after preflight while retaining Canvas fallback'
);
assert.match(main, /webglcontextlost/, 'MAX RC must recover to Canvas after WebGL context loss');
assert.match(
  main,
  /rendererType === Phaser\.CANVAS\) installCanvasTextResolutionGuard\(\)/,
  'Canvas text workaround must be scoped to the fallback path only'
);
assert.match(main, /FONT_READY_TIMEOUT_MS\s*=\s*700/, 'font loading must not block MAX startup indefinitely');
assert.match(
  main,
  /import \{ RELEASE_MARKER, RELEASE_SHA, RELEASE_SHORT \} from '\.\/release'/,
  'bundle must use centralized release identity for runtime refresh checks'
);
assert.match(releaseSource, /VITE_RELEASE_SHA/, 'client release identity must come from the build SHA');
assert.match(caddy, /handle_path \/ofeliya\/\*/, 'Ofeliya must own /ofeliya/ namespace');
assert.doesNotMatch(caddy, /handle_path \/hub\/\*/, 'Ofeliya must not claim Hub routes');
assert.doesNotMatch(botConfig, /HUB_|BOT_TOKEN\)\s*:\s*''/, 'Ofeliya bot config must not inherit Hub/Chatbot24 identity');
assert.doesNotMatch(botRuntime, /HUB_BOT_WEBHOOK_/, 'Ofeliya webhook config must never inherit Hub webhook settings');
assert.match(botRuntime, /OFELIYA_BOT_MODE must be dedicated/, 'production must reject shared bot ownership');
assert.match(botRuntime, /\/ofeliya\/bot\/webhook/, 'webhook must use Ofeliya namespace');
assert.match(maxPlatform, /ready\?: \(\) => unknown/, 'MAX adapter must expose WebAppReady capability');
assert.match(maxPlatform, /disableVerticalSwipes\?: \(\) => unknown/, 'MAX adapter must expose native swipe suppression');
assert.match(maxPlatform, /wa\.ready\?\.\(\)/, 'MAX adapter must signal WebAppReady');
assert.match(maxPlatform, /wa\.disableVerticalSwipes\?\.\(\)/, 'MAX adapter must disable shell vertical swipes');
assert.match(maxPlatform, /navigator\.share/, 'MAX adapter must retain browser share fallback for partial bridges');
assert.match(compose, /OFELIYA_ENV_FILE:-\/opt\/ofeliya\/\.env/, 'compose must use isolated Ofeliya env');
assert.match(compose, /profiles: \["dedicated-bot"\]/, 'Ofeliya webhook service must be opt-in only');
assert.doesNotMatch(compose, /\/opt\/hub|HUB_BOT_/, 'Ofeliya compose must never read Hub runtime secrets');

assert.doesNotMatch(compose, /HUB_(?:EXTRA_CA_CERT|SHARED_NETWORK)/, 'compose must not depend on Hub env names');
assert.match(compose, /OFELIYA_EXTRA_CA_CERT/, 'compose must use Ofeliya CA path variable');
assert.match(compose, /OFELIYA_SHARED_NETWORK/, 'compose must use Ofeliya network variable');
assert.match(deployScript, /COMPOSE_PROJECT="ofeliya"/, 'Cloud.ru rollout must pin Compose project to ofeliya');
assert.match(deployScript, /BOT_MODE="\$\{OFELIYA_BOT_MODE:-dedicated\}"/, 'dedicated Ofeliya bot mode must be the production default');
assert.doesNotMatch(deployScript, /HUB_BOT_|\/opt\/hub/, 'rollout must not inherit Hub/Chatbot24 bot state');
assert.match(deployScript, /compose --profile dedicated-bot up -d bot/, 'dedicated rollout must start the Ofeliya webhook process');

assert.match(deployScript, /docker compose -p "\$\{COMPOSE_PROJECT\}"/, 'all rollout compose calls must use the pinned project');
assert.match(deployScript, /APP_ROOT\}\/current/, 'legacy release layout must deploy through /opt/ofeliya/current');
assert.match(envExample, /OFELIYA_BOT_MODE=dedicated/, 'env example must declare dedicated bot ownership');
assert.match(envExample, /OFELIYA_BOT_USERNAME=id402806822924_5_bot/, 'env example must identify the canonical OFELIYA MAX bot');
assert.match(envExample, /OFELIYA_GAME_URL=https:\/\/ofeliya\.freeveol\.dpdns\.org\/ofeliya\//, 'env example must identify canonical production URL');
assert.match(envExample, /OFELIYA_SHARED_NETWORK=deploy_ofeliya/, 'env example must declare the dedicated Ofeliya network');
assert.match(envExample, /OFELIYA_EXTRA_CA_CERT=\/opt\/ofeliya\/certs\/ca-certificates\.crt/, 'env example must use an Ofeliya-owned CA path');
assert.match(compose, /VITE_MAX_BOT_NAME:\s*\$\{OFELIYA_BOT_USERNAME:\?/, 'Strain Zero bot name must be injected at build time');
assert.match(
  compose,
  /VITE_TG_BOT_USERNAME:\s*\$\{VITE_TG_BOT_USERNAME:-\}/,
  'Telegram bot username must be forwarded into the production static build when configured'
);
assert.match(
  compose,
  /VITE_TELEGRAM_APP_SHORT_NAME:\s*\$\{VITE_TELEGRAM_APP_SHORT_NAME:-\}/,
  'Telegram Mini App short name must be forwarded into the production static build when configured'
);
assert.match(compose, /VITE_DEVELOPER_LEGAL_NAME:\s*\$\{OFELIYA_DEVELOPER_LEGAL_NAME:\?/, 'legal name must be required for production static build');
assert.match(compose, /VITE_DEVELOPER_REGISTRATION:\s*\$\{OFELIYA_DEVELOPER_REGISTRATION:\?/, 'registration must be required for production static build');
assert.match(compose, /VITE_DEVELOPER_ADDRESS:\s*\$\{OFELIYA_DEVELOPER_ADDRESS:\?/, 'developer address must be required for production static build');
assert.match(compose, /VITE_SUPPORT_EMAIL:\s*\$\{OFELIYA_SUPPORT_EMAIL:\?/, 'support email must be required for production static build');
assert.match(dockerfile, /ARG VITE_MAX_BOT_NAME/, 'Dockerfile must accept the Strain Zero MAX bot name');
assert.match(dockerfile, /ARG VITE_TG_BOT_USERNAME/, 'Dockerfile must accept the Telegram bot username');
assert.match(
  dockerfile,
  /ARG VITE_TELEGRAM_APP_SHORT_NAME/,
  'Dockerfile must accept the optional Telegram Mini App short name'
);
assert.match(dockerfile, /ARG VITE_DEVELOPER_LEGAL_NAME/, 'Dockerfile must accept legal release metadata');
assert.match(dockerfile, /RUN npm run build:max/, 'production image must execute the MAX release gate');
assert.ok(
  dockerfile.indexOf('AS runtime') < dockerfile.indexOf('AS build') && dockerfile.indexOf('AS score') < dockerfile.indexOf('AS build'),
  'runtime/score targets must precede the frontend build stage for legacy Docker builders'
);
assert.match(nginx, /location = \/runtime-config\.js[\s\S]*no-store/, 'runtime config must be no-store');
assert.match(nginx, /location = \/release\.json[\s\S]*no-store/, 'public release identity must be no-store');
assert.match(runtimeConfig, /ofeliya-__OFELIYA_RELEASE__/, 'runtime config must be release-stamped after build');
assert.doesNotMatch(runtimeConfig, /location\\.(?:replace|assign|reload)/, 'runtime config must not trigger a second document navigation');
assert.match(serviceWorker, /ofeliya-__OFELIYA_RELEASE__/, 'service worker cache must be release-stamped after build');
assert.match(releaseStamp, /dist\/release\.json/, 'release stamping must emit a public immutable release identity');
assert.match(
  releaseStamp,
  /process\.env\.VITE_RELEASE_SHA \|\| 'dev'/,
  'bundle and post-build release stamping must use the same fallback'
);
assert.doesNotMatch(
  releaseStamp,
  /process\.env\.GITHUB_SHA|dev-\$\{pkg\.version/,
  'post-build stamping must not invent a release identity that Vite did not compile'
);
assert.match(
  deployWorkflow,
  /release_identity_floor="d74d31732545769af5d4a3fda232bd10cdba3800"/,
  'deploy must pin the first main commit that supports public release identity'
);
assert.match(
  deployWorkflow,
  /git merge-base --is-ancestor "\$release_identity_floor" "\$sha"/,
  'deploy must reject rollback targets that predate verifiable release identity'
);
assert.match(
  deployWorkflow,
  /secrets\.CLOUDRU_BASTION_SSH_KEY/,
  'GitHub deploy must use the restricted bastion key'
);
assert.doesNotMatch(
  deployWorkflow,
  /CLOUDRU_DEPLOY_SSH_KEY/,
  'GitHub deploy must not receive the production target private key'
);
assert.match(
  deployWorkflow,
  /ubuntu@176\.108\.246\.251[\s\S]*"deploy \$RELEASE_SHA"/,
  'GitHub deploy must invoke only the restricted bastion deploy command'
);
assert.match(compose, /VITE_RELEASE_SHA:\s*\$\{OFELIYA_RELEASE:\?/, 'production static build must receive the requested release SHA');
assert.match(dockerfile, /ARG VITE_RELEASE_SHA/, 'Dockerfile must accept the requested release SHA');
assert.match(dockerfile, /RUN test -n "\$VITE_RELEASE_SHA"/, 'production static build must refuse a missing release SHA');
assert.match(serviceWorker, /key\.startsWith\(CACHE_PREFIX\)/, 'cache cleanup must be scoped to Ofeliya');
assert.match(
  main,
  /fetch\(\`\$\{import\.meta\.env\.BASE_URL\}release\.json\`[\s\S]*cache:\s*'no-store'/,
  'MAX client must compare its bundle against uncached public release identity'
);
assert.match(main, /serverRelease === RELEASE_SHA/, 'release guard must compare full immutable SHA');
assert.match(main, /key\.startsWith\('ofeliya-'\)/, 'client-side emergency cache cleanup must remain scoped to Ofeliya');
assert.match(main, /next\.searchParams\.set\('release'/, 'stale MAX WebView must navigate to a release-distinct URL');
assert.match(main, /visibilitychange/, 'release guard must re-check after MAX resumes a retained WebView');
assert.match(main, /RELEASE_CHECK_TIMEOUT_MS\s*=\s*1200/, 'pre-boot release check must be tightly bounded');
assert.match(main, /new AbortController\(\)/, 'release fetch must be abortable');
assert.match(main, /signal:\s*controller\.signal/, 'release fetch must receive the abort signal');
assert.match(main, /controller\.abort\(\)/, 'release check timeout must abort a stalled request');
assert.match(main, /updateViaCache:\s*'none'/, 'service worker updates must bypass the HTTP cache');
assert.match(main, /registration\.update\(\)/, 'service worker must be explicitly checked on every fresh document load');

console.log('Strain Zero production release contract: ok');
