import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';

// Removing the Loader XHR timeout or procedural fallback must fail these real Boot cases.
const red = process.env.OFELIYA_ART_RECOVERY_RED === '1';
const baselinePlayer = process.env.OFELIYA_ART_PLAYER_BASELINE === '1'
  ? execFileSync('git', ['show','7a0d829:src/game/Player.ts'], {encoding:'utf8',windowsHide:true}) : null;
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: red ? [{
  name: 'art-recovery-negative-control', enforce: 'pre',
  transform(code, id) { if (id.endsWith('/BootScene.ts')) return code.replace('startMutationArtRecovery(this.game);', ''); },
}] : baselinePlayer ? [{name:'paired-player-baseline',enforce:'pre',transform(_code,id){if(id.endsWith('/game/Player.ts'))return baselinePlayer;}}] : [] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.OFELIYA_CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync), headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] });
  for (const scenario of red ? [] : ['available','missing','stalled','android-stalled']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(scenario === 'android-stalled' ? { userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' } : {}) });
    const requested = []; context.on('request', r => { if (/\/art\/[^/]+\.webp/.test(r.url())) requested.push({ url: r.url(), type: r.resourceType() }); });
    await context.route('https://st.max.ru/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    if (scenario !== 'available') await context.route('**/art/*.webp', route => scenario === 'missing' ? route.abort() : new Promise(() => {}));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    const started = Date.now();
    await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 6000 });
    const textures = await page.evaluate(() => {
      const t = window.__game.textures;
      return ['virus-player','immune-antibody','immune-tcell','immune-macrophage','immune-prime','cardiac-titan','host-cell-shadow'].map(key => ({ key, present: t.exists(key), width: t.exists(key) ? t.get(key).getSourceImage().width : 0, raw: t.exists('raw-art-' + key) }));
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    if (scenario.includes('stalled')) {
      const boot = requested.filter(r => r.type === 'xhr');
      assert.equal(boot.length, 10, 'startup XHRs must retain the original single timeout window');
      assert.equal(new Set(boot.map(r => r.url)).size, 10);
      assert.ok(requested.filter(r => r.type === 'image').length <= 3, 'only three bounded recovery images after render');
    }
    if (scenario === 'android-stalled') {
      const config = await page.evaluate(() => ({ initial: window.__game.config.loaderMaxParallelDownloads, actual: window.__game.scene.getScene('Boot').load.maxParallelDownloads }));
      assert.equal(config.initial, 6, 'Android must exercise six-download Phaser default'); assert.equal(config.actual, 10);
    }
    assert.ok(textures.every(t => t.present && t.width > 0 && !t.raw), JSON.stringify(textures));
    assert.ok(Date.now() - started < 6000, 'Menu startup must remain bounded');
    console.log(`art startup ${scenario}: Menu ready, seven canonical textures, ${Date.now() - started}ms`);
    await context.close();
  }

  const keys = ['mutation-prism','mutation-halo','mutation-singularity'];
  const evidence = process.env.OFELIYA_ART_EVIDENCE_DIR;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const results = [];
  for (const renderer of ['canvas','webgl']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 568 }, serviceWorkers: 'block' });
    const held = [], errors = [];
    const recoveryStarted = Date.now();
    let released = false;
    await context.route('https://st.max.ru/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route('**/art/mutation-*.webp', route => {
      if (route.request().resourceType() === 'xhr') return route.abort();
      if (released) return route.continue();
      held.push(route); // The first rendered Menu must exist while these images remain unavailable.
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(server.resolvedUrls.local[0] + '?renderer=' + renderer, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
    await page.waitForFunction(() => window.__game.scene.getScene('Menu').cameras.main.width === 320);
    for (let i = 0; i < 60 && held.length < 3; i++) await page.waitForTimeout(50);
    assert.equal(held.length, 3, 'fallback mutation art must recover after Menu is already usable');
    const before = await page.evaluate(async keys => {
      const game = window.__game, scene = game.scene.getScene('Menu');
      const { Player } = await import('/src/game/Player.ts');
      for (const child of scene.children.list) child.setVisible?.(false);
      scene.add.tileSprite(160, 284, 320, 568, 'blood-plasma').setDepth(-1);
      const player = new Player(scene, 160, 284);
      player.preUpdate(0, 0); // Place attached Graphics before freezing this comparison pose.
      // Freeze only this display fixture's animation; runtime recovery still uses real game events.
      player.preUpdate = () => {};
      window.__artFixture = { player, textures: keys.map(k => game.textures.get(k)), sources: keys.map(k => game.textures.get(k).getSourceImage()) };
      return keys.map(key => {
        const t = game.textures.get(key), c = t.getSourceImage(), bytes = t.getContext().getImageData(0,0,c.width,c.height).data;
        let hash = 0; for (const byte of bytes) hash = (hash * 31 + byte) | 0;
        return { key, hash, width: c.width, height: c.height };
      });
    }, keys);
    const states = [[true,false,false],[false,true,false],[false,false,true],[true,true,true]];
    const capture = async phase => {
      const frames = await page.evaluate(async states => {
        const frames = [];
        for (const state of states) {
          window.__artFixture.player.setMutationState(...state);
          // Capture synchronously after rendering, before WebGL discards its drawing buffer.
          frames.push(await new Promise(resolve => window.__game.events.once('postrender', () => resolve(window.__game.canvas.toDataURL('image/png')))));
        }
        return frames;
      }, states);
      if (evidence) frames.forEach((frame,i) => writeFileSync(resolve(evidence, `${renderer}-${i}-${phase}.png`), Buffer.from(frame.split(',')[1], 'base64')));
      return frames;
    };
    const fallbackFrames = await capture('fallback');
    console.log(`late mutation art ${renderer}: releasing images at ${Date.now() - recoveryStarted}ms; ${held.length} requests`);
    released = true;
    for (const route of held) await route.fulfill({ status: 200, contentType: 'image/webp', body: readFileSync(resolve('public/art', new URL(route.request().url()).pathname.split('/').at(-1))) });
    await page.waitForFunction(({keys,before}) => keys.every((key,i) => {
      const t = window.__game.textures.get(key), c = t.getSourceImage(), bytes = t.getContext().getImageData(0,0,c.width,c.height).data;
      let hash = 0; for (const byte of bytes) hash = (hash * 31 + byte) | 0;
      return hash !== before[i].hash;
    }), {keys,before}, { timeout: 5000 });
    const after = await page.evaluate(async keys => {
      const game = window.__game, fixture = window.__artFixture;
      return Promise.all(keys.map(async (key,i) => {
        const t = game.textures.get(key), c = t.getSourceImage();
        const expected = document.createElement('canvas'); expected.width = expected.height = 256;
        const image = new Image(); image.src = 'art/' + key + '.webp'; await image.decode();
        expected.getContext('2d').drawImage(image,0,0,256,256);
        const actualBytes = t.getContext().getImageData(0,0,256,256).data;
        const expectedBytes = expected.getContext('2d').getImageData(0,0,256,256).data;
        return { key, sameTexture: t === fixture.textures[i], sameSource: c === fixture.sources[i], width: c.width, height: c.height, packagedPixelsMatch: actualBytes.every((v,j) => v === expectedBytes[j]) };
      }));
    }, keys);
    assert.ok(after.every(t => t.sameTexture && t.sameSource && t.width === 256 && t.height === 256 && t.packagedPixelsMatch), JSON.stringify(after));
    const recoveredFrames = await capture('recovered');
    assert.ok(recoveredFrames.every((frame,i) => frame !== fallbackFrames[i]), 'each rendered mutation state must visibly update');
    const renderType = await page.evaluate(() => window.__game.renderer.type);
    assert.equal(renderType, renderer === 'canvas' ? 1 : 2, 'exercise the actual requested renderer');
    assert.equal(errors.length,0,errors.join('\n'));
    results.push({ renderer, renderType, before, after, pageErrors: errors, fixture: 'Real Phaser Player displayed at320x568 over the existing field texture; animation frozen for comparison, not gameplay/performance evidence' });
    console.log(`late mutation art ${renderer}: same existing Player texture/source, exact packaged pixels, three roles + combined capture PASS`);
    await context.close();
  }
  if (evidence) writeFileSync(resolve(evidence,'recovery.json'),JSON.stringify(results,null,2));
} finally {
  await browser?.close();
  await server.close();
}
