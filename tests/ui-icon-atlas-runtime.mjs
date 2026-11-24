#!/usr/bin/env node
/**
 * VF-02 UI icon atlas runtime checks against the real Boot/Menu flow.
 *
 * Scenarios (real Phaser via vite dev server + Chromium):
 *  - available: atlas texture + frames load; addUiIcon uses the atlas frame;
 *    makeIcons up-* textures are preserved; boot issues exactly the 10 CORE_ART
 *    XHRs; Menu stays inside the bounded startup window.
 *  - missing: aborted atlas -> BootScene installs procedural up-icon-*
 *    fallbacks for all frames; addUiIcon returns the fallback texture.
 *  - stalled: atlas requests hang -> the 1800ms timeout releases boot anyway.
 *
 * No budgets are loosened: the Menu-ready bound matches startup-art-fallback.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;

function chromeExecutable() {
  if (process.env.OFELIYA_CHROME_PATH) return process.env.OFELIYA_CHROME_PATH;
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
}

try {
  await server.listen();
  const executablePath = chromeExecutable();
  if (process.platform !== 'win32' && !executablePath) throw new Error('Chrome not found');
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const probe = async (page) => page.evaluate(async () => {
    const game = window.__game;
    const scene = game.scene.getScene('Menu');
    const { addUiIcon, hasUiIconTexture } = await import('/src/ui/uiIcons.ts');
    const icon = addUiIcon(scene, -100, -100, 'heart');
    const variantIcon = addUiIcon(scene, -100, -100, 'heart', 'danger');
    const result = {
      atlasPresent: game.textures.exists('ui-icons'),
      iconKey: icon.texture.key,
      iconFrame: icon.frame?.name ?? null,
      variantKey: variantIcon.texture.key,
      variantFrame: variantIcon.frame?.name ?? null,
      hasHeart: hasUiIconTexture(scene, 'heart'),
      upDmgProcedural: game.textures.exists('up-dmg'),
      upHealProcedural: game.textures.exists('up-heal'),
    };
    icon.destroy();
    variantIcon.destroy();
    return result;
  });

  const fallbackProbe = async (page, frames) => page.evaluate(async (framesToCheck) => {
    const game = window.__game;
    const scene = game.scene.getScene('Menu');
    const { addUiIcon } = await import('/src/ui/uiIcons.ts');
    const icon = addUiIcon(scene, -100, -100, 'heart');
    for (const frame of framesToCheck) addUiIcon(scene, -100, -100, frame).destroy();
    const result = {
      atlasPresent: game.textures.exists('ui-icons'),
      iconKey: icon.texture.key,
      fallbacksInstalled: framesToCheck.filter((frame) => game.textures.exists(`up-icon-${frame}`)),
    };
    icon.destroy();
    return result;
  }, frames);

  // Warm up the shared dev-server dependency cache so scenarios measure steady-state
  // boot (a cold vite re-optimization is environment noise, not an atlas cost).
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const page = await context.newPage();
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 30000 });
    await context.close();
  }

  const manifestIcons = ['heart', 'dna', 'activity', 'close', 'doctor', 'shield', 'coins'];

  // Scenario 1: atlas available.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const requested = [];
    context.on('request', (r) => { if (/\/art\/[^/]+\.webp/.test(r.url())) requested.push({ url: r.url(), type: r.resourceType() }); });
    await context.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const started = Date.now();
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
    const state = await probe(page);
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(state.atlasPresent, true, 'atlas texture must exist in the available scenario');
    assert.equal(state.iconKey, 'ui-icons', `addUiIcon must use the atlas, got ${state.iconKey}`);
    assert.equal(state.iconFrame, 'heart');
    assert.equal(state.variantFrame, 'heart.danger');
    assert.equal(state.hasHeart, true);
    assert.equal(state.upDmgProcedural, true, 'makeIcons up-* textures must be preserved');
    assert.equal(state.upHealProcedural, true);
    const artXhrs = requested.filter((r) => r.type === 'xhr');
    assert.equal(artXhrs.length, 10, 'startup XHRs must retain the original single timeout window');
    assert.ok(Date.now() - started < 6000, 'Menu startup must remain bounded with the atlas load added');
    console.log(`ui-icon-atlas runtime available: atlas frame + preserved up-* + 10 art XHRs, ${Date.now() - started}ms PASS`);
    await context.close();
  }

  // Scenario 2: atlas missing (aborted) -> instant procedural fallbacks.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route('**/assets/ui-icons-atlas*', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const started = Date.now();
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
    const state = await fallbackProbe(page, manifestIcons);
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(state.atlasPresent, false, 'atlas must stay absent when its requests fail');
    assert.equal(state.iconKey, 'up-icon-heart', `fallback texture expected, got ${state.iconKey}`);
    assert.deepEqual(state.fallbacksInstalled, manifestIcons, 'BootScene must install up-icon-* fallbacks for every frame');
    assert.ok(Date.now() - started < 6000, 'missing atlas must not delay Menu');
    console.log(`ui-icon-atlas runtime missing: up-icon-* fallbacks installed, ${Date.now() - started}ms PASS`);
    await context.close();
  }

  // Scenario 3: atlas stalled -> the shared 1800ms timeout still releases boot.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route('https://st.max.ru/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route('**/assets/ui-icons-atlas*', () => new Promise(() => {}));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const started = Date.now();
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
    const state = await fallbackProbe(page, manifestIcons);
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(state.atlasPresent, false, 'stalled atlas must time out and stay absent');
    assert.equal(state.iconKey, 'up-icon-heart');
    assert.deepEqual(state.fallbacksInstalled, manifestIcons);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 6000, 'stalled atlas must release boot inside the shared window');
    console.log(`ui-icon-atlas runtime stalled: boot released after bounded wait, ${elapsed}ms PASS`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
