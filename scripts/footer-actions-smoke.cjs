const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const prefixes = ['муз', 'звук:', 'эфф', 'СВОДКА', 'КОДЕКС', 'О ПРИЛОЖЕНИИ', 'mini-app'];
async function geometry(page) { return (await page.evaluate(() => { const s = window.__game.scene.getScene('Menu'); return s.children.list.filter(o => o.type === 'Text' && o.input && /^(муз|звук:|эфф|СВОДКА$|КОДЕКС |О ПРИЛОЖЕНИИ|mini-app)/.test(o.text)).map(o => ({ text: o.text, x: o.x - o.displayOriginX + o.input.hitArea.x, y: o.y - o.displayOriginY + o.input.hitArea.y, w: o.input.hitArea.width, h: o.input.hitArea.height, b: o.getBounds() })); })).sort((a,b)=>prefixes.findIndex(p=>a.text.startsWith(p))-prefixes.findIndex(p=>b.text.startsWith(p))); }
function check(targets, viewport) { assert.equal(targets.length, 7); for (const t of targets) {
    assert.ok(t.w >= 44 && t.h >= 44, JSON.stringify(t));
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= viewport.width + .01 && t.y + t.h <= viewport.height + .01, JSON.stringify(t));
} for (let i = 0; i < targets.length; i++)
    for (let j = i + 1; j < targets.length; j++) {
        const a = targets[i], b = targets[j];
        assert.ok(!(a.x < b.x + b.w - .01 && b.x < a.x + a.w - .01 && a.y < b.y + b.h - .01 && b.y < a.y + a.h - .01), 'overlapping footer hits');
    } }
(async () => {
    const { createServer } = await import('vite');
    const server = process.env.OFELIYA_BASE_URL ? { resolvedUrls: { local: [process.env.OFELIYA_BASE_URL] }, listen: async () => { }, close: async () => { } } : await createServer({ server: { host: '127.0.0.1', port: 5188 } });
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
                for (let index = 0; index < 7; index++) {
                    if (index) {
                        await p.evaluate(() => window.__game.scene.getScene('Menu').scene.restart());
                        await p.waitForTimeout(100);
                    }
                    const targets = await geometry(p);
                    check(targets, viewport);
                    const t = targets[index];
                    const clear = await p.evaluate(() => { const s = window.__game.scene.getScene('Menu'); const o = s.children.getByName('ofeliya-menu-new-run') || s.children.getByName('ofeliya-menu-action-bg'); const b = o.getBounds(); return b.y + b.height; });
                    assert.ok(targets[0].y >= clear - .01, 'footer clears CTA/new-run');
                    await p.evaluate(() => { window.__footerEvents = []; const s = window.__game.scene.getScene('Menu'); for (const o of s.children.list.filter(o => o.type === 'Text' && o.input && /^(муз|звук:|эфф|СВОДКА$|КОДЕКС |О ПРИЛОЖЕНИИ|mini-app)/.test(o.text)))
                        o.on('pointerup', () => window.__footerEvents.push(o.text)); });
                    const point = { x: t.x + t.w / 2, y: t.y + t.h - 2 };
                    assert.ok(point.y > t.b.y + t.b.height, 'tap is outside visible label');
                    const repeats = index === 0 || index === 2 || index === 6 ? 5 : index === 1 ? 2 : 1;
                    const labels = [];
                    for (let n = 0; n < repeats; n++) {
                        const current = (await geometry(p))[index];
                        await p.touchscreen.tap(current.x + current.w / 2, current.y + current.h - 2);
                        if (index < 3) {
                            const after = await geometry(p);
                            check(after, viewport);
                            assert.notEqual(after[index].text, current.text, 'actual handler changed label');
                            labels.push(after[index].text);
                        }
                    }
                    const got = await p.evaluate(() => window.__footerEvents);
                    assert.equal(got.length, repeats, 'one intended action per tap');
                    assert.ok(got.every(s => s.startsWith(prefixes[index])), 'no neighboring action '+JSON.stringify({index,got}));
                    if (index === 0 || index === 2) {
                        assert.ok(labels.some(s => s.includes('0%')) && labels.some(s => s.includes('100%')), 'real volume cycle covers extremes');
                    }
                    if (index === 3)
                        assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').socialHub), true);
                    if (index === 4)
                        assert.equal(await p.evaluate(() => !!window.__game.scene.getScene('Menu').codexOverlay), true);
                    if (index === 5) {
                        assert.equal(await p.locator('.legal-close').count(), 1);
                        await p.keyboard.press('Escape');
                    }
                    if (index === 6) {
                        assert.equal(await p.locator('#ofeliya-startup-trace').count(), 1);
                        await p.evaluate(() => document.getElementById('ofeliya-startup-trace').remove());
                    }
                }
                // Geometry was checked after each actual volume/mute action, including the full volume cycle.
                await p.screenshot({ path: path.join(out, `footer-actions-${viewport.width}-${resumed ? 'resume' : 'fresh'}.png`) });
                fs.writeFileSync(path.join(out, `footer-actions-${viewport.width}-${resumed ? 'resume' : 'fresh'}.json`), JSON.stringify(await geometry(p), null, 2));
                assert.deepEqual(errors, []);
                console.log('footer real touch PASS', viewport.width, resumed ? 'resume' : 'fresh');
                await ctx.close();
            }
    }
    finally {
        await b.close();
        await server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
