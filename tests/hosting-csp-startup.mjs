import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const directory = mkdtempSync(join(tmpdir(), 'ofeliya-csp-browser-'));
async function freePort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve)); return port;
}
const port = await freePort();
let apiPort = await freePort();
while (apiPort === port) apiPort = await freePort();
const env = { ...process.env, SERVER_PORT: String(port), OFELIYA_API_PORT: String(apiPort),
  DATA_DIR: directory, OFELIYA_DIST_DIR: resolve('dist'), RENDER: 'false' };
for (const key of ['OFELIYA_STATE_URL', 'OFELIYA_STATE_TOKEN', 'TG_BOT_TOKEN', 'TG_WEBHOOK_SECRET', 'MAX_BOT_TOKEN', 'OFELIYA_MAX_BOT_TOKEN', 'OFELIYA_BOT_TOKEN']) delete env[key];
const child = spawn(process.execPath, [resolve('server/hosting.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const exit = once(child, 'exit');
let output = '', browser;
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
try {
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    if (child.exitCode !== null) throw new Error(output);
    try { ready = (await fetch(base + '/ready')).ok; } catch {}
    if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, output);
  const executablePath = process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 740 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => { window.__cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push(event.violatedDirective)); });
  await page.route('https://st.max.ru/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  const response = await page.goto(base + '/ofeliya/?renderer=canvas', { waitUntil: 'domcontentloaded' });
  assert.ok(response.headers()['content-security-policy']);
  await page.waitForFunction(() => !document.querySelector('#splash') && document.querySelectorAll('#game canvas').length === 1);
  assert.deepEqual(await page.evaluate(() => window.__cspViolations), []);
  assert.deepEqual(errors, []);
  console.log('Built Render gateway + real Chromium: CSP bootstrap/startup PASS');
} finally { await browser?.close(); child.kill(); await exit; rmSync(directory, { recursive: true, force: true }); }
