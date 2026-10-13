import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  return port;
}
const dir = mkdtempSync(join(tmpdir(), 'ofeliya-hosting-'));
mkdirSync(join(dir, 'dist'));
const inlineScript = 'window.fixture = true;';
const html = `<script>${inlineScript}</script>hosting-fixture`;
writeFileSync(join(dir, 'dist', 'index.html'), html);

async function check(mode) {
  const configured = mode === 'configured';
  const broken = mode === 'broken';
  const port = await freePort();
  let apiPort = await freePort();
  while (apiPort === port) apiPort = await freePort();
  const env = { ...process.env, SERVER_PORT: String(port), OFELIYA_API_PORT: String(apiPort),
    DATA_DIR: join(dir, mode),
    OFELIYA_DIST_DIR: join(dir, 'dist'), RENDER: 'false', NODE_ENV: 'production', WRITE_RATE_LIMIT: '1',
    OFELIYA_BOT_TOKEN: configured || broken ? 'hosting-test-token' : '',
    OFELIYA_BOT_USERNAME: broken ? '' : 'id100000000000_test_bot', OFELIYA_BOT_MODE: 'dedicated',
    OFELIYA_BOT_WEBHOOK_DOMAIN: 'https://example.test',
    OFELIYA_BOT_WEBHOOK_PATH: '/ofeliya/bot/webhook',
    OFELIYA_BOT_WEBHOOK_SECRET: '0123456789abcdef0123456789abcdef' };
  // Never inherit real remote state or messenger secrets into the fixture.
  for (const key of ['OFELIYA_STATE_URL', 'OFELIYA_STATE_TOKEN', 'TG_BOT_TOKEN', 'TG_WEBHOOK_SECRET',
    'MAX_BOT_TOKEN', 'OFELIYA_MAX_BOT_TOKEN', 'VK_SECURE_KEY']) delete env[key];
  const child = spawn(process.execPath, [resolve('server/hosting.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const exit = once(child, 'exit');
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let n = 0; n < 100 && !ready; n++) {
      if (child.exitCode !== null) throw new Error(output);
      try { ready = (await fetch(base + '/health')).ok; } catch {}
      if (!ready) await new Promise(r => setTimeout(r, 50));
    }
    assert.ok(ready, output);
    const page = await fetch(base + '/ofeliya/');
    assert.equal(await page.text(), html);
    const csp = page.headers.get('content-security-policy');
    assert.ok(csp, 'Render gateway must emit an effective CSP');
    assert.ok(csp.includes(`'sha256-${createHash('sha256').update(inlineScript).digest('base64')}'`));
    assert.ok(!csp.split(';').find(part => part.trim().startsWith('script-src')).includes('unsafe-inline'));
    assert.match(csp, /frame-ancestors.*https:\/\/web\.telegram\.org/);
    assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(page.headers.get('permissions-policy'), /camera=\(\)/);
    assert.match(page.headers.get('strict-transport-security'), /max-age=31536000/);
    const readiness = await fetch(base + '/ready');
    assert.equal(readiness.status, broken ? 503 : 200);
    assert.equal((await readiness.json()).integrations.max.state, broken ? 'failed' : configured ? 'configured' : 'disabled');
    assert.equal((await fetch(base + '/ofeliya/missing')).headers.get('content-security-policy'), csp);
    assert.equal((await fetch(base + '/api/top')).status, 200);
    if (mode === 'disabled') {
      const statuses = [];
      for (let index = 0; index < 13; index++) {
        const response = await fetch(base + '/ofeliya/api/score', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${index}` },
          body: JSON.stringify({ platform: 'browser', anonId: `gateway-spoof-${index}`,
            payload: { win: false, timeMs: 1000, kills: 1, level: 1 } }) });
        statuses.push(response.status);
      }
      assert.deepEqual(statuses.slice(0, 12), Array(12).fill(200));
      assert.equal(statuses[12], 429, 'gateway must replace spoofable forwarding chains');
    }
    // These are the relative URLs used by clients loaded from /ofeliya/.
    const gameApi = new URL('api/top?limit=1', base + '/ofeliya/');
    const top = await fetch(gameApi);
    assert.equal(top.status, 200);
    assert.match(top.headers.get('content-type'), /application\/json/);
    assert.equal((await fetch(base + '/ofeliya/api/telegram/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    })).status, 403, 'Telegram route must reach the API authentication handler');
    const url = base + '/ofeliya/bot/webhook';
    const post = (body, secret) => fetch(url, { method: 'POST',
      headers: { 'x-max-bot-api-secret': secret }, body });
    assert.equal((await post('{}', 'wrong')).status, configured ? 404 : 503);
    if (configured) {
      assert.equal((await post('{', env.OFELIYA_BOT_WEBHOOK_SECRET)).status, 400);
      // An unsupported update exercises delivery without sending any real message.
      assert.equal((await post(JSON.stringify({ update_type: 'user_removed', timestamp: Date.now() }),
        env.OFELIYA_BOT_WEBHOOK_SECRET)).status, 200);
      const fields = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 42 }) };
      const dataCheck = Object.keys(fields).sort().map(key => `${key}=${fields[key]}`).join('\n');
      const secret = createHmac('sha256', 'WebAppData').update(env.OFELIYA_BOT_TOKEN).digest();
      fields.hash = createHmac('sha256', secret).update(dataCheck).digest('hex');
      const profile = await fetch(new URL('api/profile', base + '/ofeliya/'), {method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({platform: 'max', initData: new URLSearchParams(fields).toString()}) });
      assert.equal(profile.status, 200, 'hosted MAX profile must use the dedicated token');
    }
  } finally {
    child.kill();
    await exit;
  }
}
try { await check('configured'); await check('disabled'); await check('broken'); }
finally { rmSync(dir, { recursive: true, force: true }); }
console.log('Hosting gateway: game, API and configured/unconfigured MAX webhook passed');
