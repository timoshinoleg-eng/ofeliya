const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
(async () => {
    const { createServer } = await import('vite');
    const server = process.env.OFELIYA_BASE_URL ? { resolvedUrls: { local: [process.env.OFELIYA_BASE_URL] }, listen: async () => { }, close: async () => { } } : await createServer({ server: { host: '127.0.0.1', port: 5188 } });
    await server.listen();
    console.log("server", server.resolvedUrls);
    const browser = await chromium.launch({ headless: true, executablePath: process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync) });
    const url = server.resolvedUrls.local[0];
    const dir = process.env.UX_EVIDENCE || 'evidence/verified-ux-20261026';
    fs.mkdirSync(dir, { recursive: true });
    try {
        for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 740 }, { width: 768, height: 1024 }, { width: 1080, height: 1920 }])
            for (const reducedMotion of ['reduce', 'no-preference']) {
                const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, reducedMotion });
                await context.route('https://st.max.ru/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
                const page = await context.newPage();
                console.log('goto', url);
                await page.goto(url + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
                console.log('loaded');
                await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
                console.log('menu');
                const targets = await page.evaluate(() => { const s = window.__game.scene.getScene('Menu'); const names = ['ofeliya-menu-nav-rating','ofeliya-menu-nav-tasks','ofeliya-menu-nav-codex','ofeliya-menu-nav-collection','ofeliya-menu-nav-lab','ofeliya-menu-nav-strains','ofeliya-menu-audio-music','ofeliya-menu-audio-sound','ofeliya-menu-audio-effects','ofeliya-menu-legal']; return names.map(name => { const o = s.children.getByName(name); if (!o) return { name, missing: true }; const b = o.getBounds(); return { name, w: b.width, h: b.height, x: b.x, y: b.y, visual: b }; }); });
                fs.writeFileSync(path.join(dir, `menu-${viewport.width}-${reducedMotion}.json`), JSON.stringify(targets, null, 2));
                await page.screenshot({ path: path.join(dir, `menu-${viewport.width}-${reducedMotion}.png`) });
                if (process.argv.includes('--footer')) {
                    assert.equal(targets.length, 10);
                    for (const t of targets) {
                        assert.equal(t.missing, undefined, 'missing menu target: ' + JSON.stringify(t));
                        assert.ok(t.w >= 44 && t.h >= 44, 'footer target below44: ' + JSON.stringify(t));
                        assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= viewport.width + .01 && t.y + t.h <= viewport.height + .01, 'target in safe canvas');
                    }
                    for (let i = 0; i < targets.length; i++)
                        for (let j = i + 1; j < targets.length; j++) {
                            const a = targets[i], b = targets[j];
                            assert.ok(!(a.x < b.x + b.w - .01 && b.x < a.x + a.w - .01 && a.y < b.y + b.h - .01 && b.y < a.y + a.h - .01), 'footer targets overlap ' + JSON.stringify([a, b]));
                        }
                    const action = await page.evaluate(() => window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-action-bg').getBounds());
                    assert.ok(targets[0].y >= action.y + action.height - .01, 'expanded footer must clear CTA');
                }
                if (!process.argv.includes('--footer')) {
                    await page.evaluate(() => { const g = window.__game, s = g.scene.getScene('Game'); s.events.once('create', () => { s.runState.stage.xpNext = 1000000; s.physics.world.pause(); }); g.scene.getScene('Menu').scene.start('Game'); });
                    await page.waitForFunction(() => window.__game.scene.isActive('UI'));
                    const state = await page.evaluate(() => { const g = window.__game, s = g.scene.getScene('Game'), u = g.scene.getScene('UI'); u.renderOnboarding(); return { intro: !!s.introHint?.visible, tutorial: !!u.onboardingContainer?.visible }; });
                    await page.screenshot({ path: path.join(dir, `startup-${viewport.width}-${reducedMotion}.png`) });
                    assert.ok(!(state.intro && state.tutorial), 'startup and tutorial share region: ' + JSON.stringify(state));
                }
                await context.close();
                console.log('PASS', viewport.width, reducedMotion);
            }
    }
    finally {
        await browser.close();
        await server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
