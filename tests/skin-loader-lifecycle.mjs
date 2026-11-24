/** Real browser regression: Phaser SVG decoding, loader ownership and 80 overlay cycles. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const chrome = [process.env.OFELIYA_CHROME_PATH, process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].filter(Boolean).find(existsSync);
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  for (const renderer of ['canvas', 'webgl']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 740 }, serviceWorkers: 'block' });
    try {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await ctx.route('**/*', r => {
        const u = new URL(r.request().url());
        if (u.pathname.includes('/api/')) return r.fulfill({ status: 503, body: '{}', contentType: 'application/json' });
        if (u.hostname === 'st.max.ru') return r.fulfill({ body: '', contentType: 'application/javascript' });
        return u.origin === new URL(base).origin ? r.continue() : r.abort();
      });
      await page.addInitScript(() => localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 4 })));
      await page.goto(base + '?renderer=' + renderer + '&flag.skins.gallery=true&flag.storefront.variant=mock', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
      await page.waitForFunction(async () => {
        const g = window.__game, m = g.scene.getScene('Menu');
        const d = await import('/src/game/DeferredMenuArt.ts');
        return d.deferredMenuArtMetrics.organicComplete && g.textures.exists('ui-icons') &&
          !m.load.isLoading() && !m.events.listeners('update').includes(m.load.update);
      }, null, { timeout: 20000 });
      assert.equal(await page.evaluate(() => window.__game.renderer.type), renderer === 'canvas' ? 1 : 2);
      const contract = await page.evaluate(async () => {
        const { encodeSkinSvgDataUrl, skinSvgDataUrl, ensureSkinTexture } = await import('/src/game/skins/SkinArt.ts');
        const { listSkins, skinTextureKey } = await import('/src/game/skins/SkinCatalog.ts');
        const decode = url => new DOMParser().parseFromString(atob(url.split(';base64,')[1]), 'image/svg+xml');
        const unicode = '\u041a\u043b\u0435\u0442\u043a\u0430 \u00e9 \u{1f9ec}';
        const doc = decode(encodeSkinSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><text>' + unicode + '</text></svg>'));
        const defs = listSkins().slice(1);
        const valid = defs.every(d => decode(skinSvgDataUrl(d)).documentElement.localName === 'svg');
        const EventEmitter = window.__game.scene.getScene('Menu').events.constructor;
        const run = async (kind) => {
          const load = new EventEmitter(), events = new EventEmitter();
          const key = skinTextureKey(defs[0].id), complete = 'filecomplete-svg-' + key;
          let settled = false;
          load.svg = () => {};
          load.start = () => { if (kind === 'throw') throw Error('synthetic'); };
          const promise = ensureSkinTexture({ load, events, textures: { exists: () => false } }, defs[0]).then(() => { settled = true; });
          load.emit('loaderror', { key: 'unrelated' });
          await Promise.resolve();
          const foreignIgnored = !settled && load.listenerCount('loaderror') === 1;
          if (kind === 'success') load.emit(complete);
          if (kind === 'error') load.emit('loaderror', { key });
          if (kind === 'shutdown') events.emit('shutdown');
          await Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error('unsettled ' + kind)), 1000))]);
          return { kind, foreignIgnored, settled, remaining: [load.listenerCount(complete), load.listenerCount('loaderror'), events.listenerCount('shutdown')] };
        };
        return { unicode: doc.querySelector('text')?.textContent, valid, rows: await Promise.all(['success', 'error', 'shutdown', 'throw'].map(run)) };
      });
      assert.equal(contract.unicode, '\u041a\u043b\u0435\u0442\u043a\u0430 \u00e9 \u{1f9ec}');
      assert.equal(contract.valid, true);
      for (const row of contract.rows) {
        if (row.kind !== 'throw') assert.equal(row.foreignIgnored, true, row.kind);
        assert.equal(row.settled, true, row.kind);
        assert.deepEqual(row.remaining, [0, 0, 0], row.kind);
      }
      await page.evaluate(() => {
        const m = window.__game.scene.getScene('Menu');
        window.__boardCounts = () => ({
          shutdown: m.events.listenerCount('shutdown'), update: m.events.listenerCount('update'),
          resize: m.scale.listenerCount('resize'), loaderErrors: m.load.listenerCount('loaderror'),
          ...Object.fromEntries(['pointerdown', 'pointermove', 'pointerup', 'pointerupoutside', 'wheel', 'gameout'].map(e => [e, m.input.listenerCount(e)]))
        });
      });
      const baseline = await page.evaluate(() => window.__boardCounts());
      for (const [method, field, close] of [
        ['showQuestBoard', 'questBoard', 'destroy'], ['showSocialHub', 'socialHub', 'destroy'],
        ['showCollectionBoard', 'collectionBoard', 'destroy'], ['showSkins', 'skinGallery', 'close']
      ]) {
        for (let i = 0; i < 10; i++) {
          await page.evaluate(({ method, field }) => {
            const m = window.__game.scene.getScene('Menu'); m[method](); if (!m[field]) throw Error(field + ' not open');
          }, { method, field });
          if (field === 'skinGallery' && i % 2 === 0) {
            await page.waitForFunction(async () => {
              const g = window.__game, m = g.scene.getScene('Menu');
              const { listSkins, skinTextureKey } = await import('/src/game/skins/SkinCatalog.ts');
              const walk = o => o.name === 'ofeliya-skin-gallery-grid' || (o.list || []).some(walk);
              return m.children.list.some(walk) && listSkins().slice(1).every(d => g.textures.exists(skinTextureKey(d.id)));
            }, null, { timeout: 10000 });
          }
          await page.evaluate(({ field, close }) => {
            const m = window.__game.scene.getScene('Menu'); m[field][close](); if (m[field]) throw Error(field + ' retained');
          }, { field, close });
          await page.waitForTimeout(40);
          assert.deepEqual(await page.evaluate(() => window.__boardCounts()), baseline, renderer + ' ' + field + ' cycle ' + i);
        }
        console.log('PASS ' + renderer + ' ' + field + ' x10');
      }
      await page.waitForTimeout(300);
      assert.deepEqual(await page.evaluate(() => window.__boardCounts()), baseline);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
  console.log('skin-loader lifecycle: Unicode, foreign errors, shutdown, 80 overlay cycles PASS');
} finally {
  await browser?.close();
  await server.close();
}
