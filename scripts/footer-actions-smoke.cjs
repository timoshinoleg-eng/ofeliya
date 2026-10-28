const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const TARGETS = [
  'ofeliya-menu-nav-rating',
  'ofeliya-menu-nav-tasks',
  'ofeliya-menu-nav-codex',
  'ofeliya-menu-nav-collection',
  'ofeliya-menu-nav-lab',
  'ofeliya-menu-nav-strains',
  'ofeliya-menu-audio-music',
  'ofeliya-menu-audio-sound',
  'ofeliya-menu-audio-effects',
  'ofeliya-menu-legal',
  'ofeliya-menu-diagnostics',
];
const AUDIO_PREFIX = {
  'ofeliya-menu-audio-music': '♪ Музыка',
  'ofeliya-menu-audio-sound': 'Звук',
  'ofeliya-menu-audio-effects': 'Эффекты',
};
async function geometry(page) {
  return page.evaluate((names) => {
    const s = window.__game.scene.getScene('Menu');
    return names.map((name) => {
      const o = s.children.getByName(name);
      if (!o) return { name, missing: true };
      const b = o.getBounds();
      return { name, x: b.x, y: b.y, w: b.width, h: b.height };
    });
  }, TARGETS);
}
function check(targets, viewport) {
  assert.equal(targets.length, TARGETS.length);
  for (const t of targets) {
    assert.equal(t.missing, undefined, 'missing target ' + t.name);
    assert.ok(t.w >= 44 && t.h >= 44, 'target below 44px ' + JSON.stringify(t));
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= viewport.width + .01 && t.y + t.h <= viewport.height + .01, 'target outside canvas ' + JSON.stringify(t));
  }
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) {
    const a = targets[i], b = targets[j];
    assert.ok(!(a.x < b.x + b.w - .01 && b.x < a.x + a.w - .01 && a.y < b.y + b.h - .01 && b.y < a.y + a.h - .01), 'overlapping targets ' + a.name + '/' + b.name);
  }
}
async function audioLabel(page, name) {
  return page.evaluate(({ name, prefixes }) => {
    const s = window.__game.scene.getScene('Menu');
    const prefix = prefixes[name];
    return s.children.list.find((o) => o.type === 'Text' && typeof o.text === 'string' && o.text.startsWith(prefix))?.text ?? null;
  }, { name, prefixes: AUDIO_PREFIX });
}
(async () => {
  const { createServer } = await import('vite');
  const server = process.env.OFELIYA_BASE_URL ? { resolvedUrls: { local: [process.env.OFELIYA_BASE_URL] }, listen: async () => {}, close: async () => {} } : await createServer({ server: { host: '127.0.0.1', port: 5188 } });
  await server.listen();
  const b = await chromium.launch({ headless: true, executablePath: process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync) });
  const out = process.env.UX_EVIDENCE || 'evidence/verified-ux-20261026';
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 740 }, { width: 768, height: 1024 }, { width: 1080, height: 1920 }])
      for (const resumed of [false, true]) {
        const ctx = await b.newContext({ viewport, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
        await ctx.route('https://st.max.ru/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
        const p = await ctx.newPage();
        const errors = [];
        p.on('pageerror', e => errors.push(String(e)));
        await p.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(() => window.__game?.scene.isActive('Menu'));
        if (resumed) {
          await p.evaluate(() => { const g = window.__game, s = g.scene.getScene('Game'); s.events.once('create', () => g.scene.pause('Game')); g.scene.getScene('Menu').scene.start('Game'); });
          await p.waitForFunction(() => window.__game.scene.isActive('UI'));
          await p.evaluate(() => { const g = window.__game; g.scene.getScene('UI').scene.start('Menu'); g.scene.stop('Game'); });
          await p.waitForFunction(() => window.__game.scene.isActive('Menu'));
          assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-new-run')), true, 'valid checkpoint produces resume menu');
        }
        for (let index = 0; index < TARGETS.length; index++) {
          if (index) {
            await p.evaluate(() => window.__game.scene.getScene('Menu').scene.restart());
            await p.waitForTimeout(100);
          }
          const targets = await geometry(p);
          check(targets, viewport);
          const t = targets[index];
          const clear = await p.evaluate(() => { const s = window.__game.scene.getScene('Menu'); const o = s.children.getByName('ofeliya-menu-new-run') || s.children.getByName('ofeliya-menu-action-bg'); const b = o.getBounds(); return b.y + b.height; });
          assert.ok(targets[0].y >= clear - .01, 'meta controls clear CTA/new-run');
          await p.evaluate((name) => {
            window.__footerEvents = [];
            const o = window.__game.scene.getScene('Menu').children.getByName(name);
            o.on('pointerup', () => window.__footerEvents.push(name));
          }, t.name);
          const beforeLabel = AUDIO_PREFIX[t.name] ? await audioLabel(p, t.name) : null;
          // A tap outside the target must not reach it: the hit area belongs to
          // the target and to nothing else. The point is picked outside the
          // target and outside every other target, so the check measures the
          // hit area and not the neighbour.
          // The point stays in the band of the target, so the check measures
          // the hit area and not the control above the footer.
          const free = [
            { x: t.x - 6, y: t.y + t.h / 2 },
            { x: t.x + t.w + 6, y: t.y + t.h / 2 },
          ].find((c) => c.x >= 0 && c.y >= 0 && c.x <= viewport.width && c.y <= viewport.height
            && !targets.some((o) => o.name !== t.name
              && c.x > o.x && c.x < o.x + o.w && c.y > o.y && c.y < o.y + o.h));
          if (free) {
            await p.touchscreen.tap(free.x, free.y);
            assert.deepEqual(await p.evaluate(() => window.__footerEvents), [], 'a tap outside the target reached it ' + t.name);
          }
          await p.touchscreen.tap(t.x + t.w / 2, t.y + t.h - 2);
          const got = await p.evaluate(() => window.__footerEvents);
          assert.deepEqual(got, [t.name], 'one intended action per tap ' + t.name);
          if (AUDIO_PREFIX[t.name]) {
            const after = await audioLabel(p, t.name);
            assert.ok(beforeLabel && after && beforeLabel !== after, 'audio handler changed label ' + t.name);
            // The switch reaches both extremes of its cycle: off, and on again.
            // The label is what the player reads, so the label is the contract.
            await p.evaluate(() => { window.__footerEvents = []; });
            for (let cycle = 0; cycle < 4; cycle += 1) {
              const label = await audioLabel(p, t.name);
              if (label && label.endsWith(': выкл')) break;
              await p.touchscreen.tap(t.x + t.w / 2, t.y + t.h - 2);
              await p.waitForTimeout(60);
            }
            const offLabel = await audioLabel(p, t.name);
            assert.ok(offLabel && offLabel.endsWith(': выкл'), 'the switch never reached the off extreme ' + t.name + ' (' + offLabel + ')');
            await p.touchscreen.tap(t.x + t.w / 2, t.y + t.h - 2);
            await p.waitForTimeout(60);
            const onLabel = await audioLabel(p, t.name);
            assert.ok(onLabel && onLabel.endsWith(': вкл'), 'the switch never returned from the off extreme ' + t.name + ' (' + onLabel + ')');
            check(await geometry(p), viewport);
          } else if (t.name === 'ofeliya-menu-nav-rating') {
            assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').socialHub), true);
          } else if (t.name === 'ofeliya-menu-nav-tasks') {
            assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').questBoard), true);
          } else if (t.name === 'ofeliya-menu-nav-codex') {
            assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').codexOverlay), true);
          } else if (t.name === 'ofeliya-menu-nav-collection') {
            assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').collectionBoard), true);
          } else if (t.name === 'ofeliya-menu-nav-lab') {
            assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').labPanel), true);
          } else if (t.name === 'ofeliya-menu-nav-strains') {
            assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').strainsStub), true);
          } else if (t.name === 'ofeliya-menu-diagnostics') {
            for (let n = 0; n < 4; n++) await p.touchscreen.tap(t.x + t.w / 2, t.y + t.h - 2);
            assert.equal(await p.locator('#ofeliya-startup-trace').count(), 1, 'five diagnostic taps reveal the trace');
          } else if (t.name === 'ofeliya-menu-legal') {
            assert.equal(await p.locator('.legal-close').count(), 1);
            await p.keyboard.press('Escape');
          }
        }
        await p.screenshot({ path: path.join(out, 'footer-actions-' + viewport.width + '-' + (resumed ? 'resume' : 'fresh') + '.png') });
        fs.writeFileSync(path.join(out, 'footer-actions-' + viewport.width + '-' + (resumed ? 'resume' : 'fresh') + '.json'), JSON.stringify(await geometry(p), null, 2));
        assert.deepEqual(errors, []);
        console.log('footer real touch PASS', viewport.width, resumed ? 'resume' : 'fresh');
        await ctx.close();
      }
  } finally {
    await b.close();
    await server.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
