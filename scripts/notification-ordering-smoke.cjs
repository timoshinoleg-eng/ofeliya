const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const { startCombatFixture } = require('./lib/combat-fixture.cjs');
async function chooseOffer(page) {
    const xy = await page.evaluate(() => { const g = window.__game, u = g.scene.getScene('UI'), s = g.scene.getScene('Game'); const index = Math.max(0, s.pendingChoices.findIndex(d => !d.kind || d.kind === 'upgrade')); const cards = u.modal.list.filter(o => o.type === 'Container' && o.list?.some(c => c.type === 'Rectangle' && c.input)); const b = cards[index].list.find(c => c.type === 'Rectangle' && c.input).getBounds(); return { x: b.centerX, y: b.centerY }; });
    await page.touchscreen.tap(xy.x, xy.y);
    await page.waitForFunction(() => !window.__game.scene.getScene('UI').modalOpen);
}
(async () => {
    const { createServer } = await import('vite');
    const server = process.env.OFELIYA_BASE_URL ? { resolvedUrls: { local: [process.env.OFELIYA_BASE_URL] }, listen: async () => { }, close: async () => { } } : await createServer({ server: { host: '127.0.0.1', port: 5189 } });
    await server.listen();
    const browser = await chromium.launch({ headless: true, executablePath: process.platform === 'win32' ? undefined : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync) });
    const out = process.env.UX_EVIDENCE || 'evidence/verified-ux-20261026';
    try {
        for (const reducedMotion of ['reduce', 'no-preference']) {
            const context = await browser.newContext({ viewport: { width: 390, height: 740 }, isMobile: true, hasTouch: true, reducedMotion });
            await context.route('https://st.max.ru/**', r => r.fulfill({ body: '', contentType: 'application/javascript' }));
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', e => errors.push(String(e)));
            await page.goto(server.resolvedUrls.local[0] + '?renderer=canvas', { waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
            console.log('ordering menu', reducedMotion);
            await startCombatFixture(page);
            await page.waitForFunction(() => window.__game.scene.isActive('UI'));
            console.log('ordering UI');
            await page.evaluate(() => { const s = window.__game.scene.getScene('Game'), u = window.__game.scene.getScene('UI'); s.physics.world.pause(); s.hostCells.update = () => { }; u.onboarding.tick = () => { }; });
            // Opening mutation must suspend the live startup surface, not cancel it.
            await page.evaluate(() => { window.__game.scene.getScene('Game').queuedLevels = 1; });
            await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
            assert.equal(await page.evaluate(() => !!window.__game.scene.getScene('Game').introHint?.visible), false);
            await chooseOffer(page);
            await page.waitForFunction(() => !!window.__game.scene.getScene('Game').introHint?.visible);
            await page.waitForFunction(() => !window.__game.scene.getScene('Game').notificationRegion.occupied);
            console.log('startup mutation suspension PASS', reducedMotion);
            for (let step = 0; step < 5; step++) {
                console.log("step", step + 1);
                await page.evaluate(async (step) => { const g = window.__game, s = g.scene.getScene('Game'), u = g.scene.getScene('UI'); s.notificationRegion.destroy(); s.milestones.reset(); const { NotificationRegion } = await import('/src/ui/NotificationRegion.ts'); const { RunMilestones } = await import('/src/game/RunMilestones.ts'); s.notificationRegion = new NotificationRegion(); s.milestones = new RunMilestones(s, s.notificationRegion); u.discardContextHint(); u.onboarding.start(); for (let n = 0; n < step; n++)
                    u.onboarding.advance(); u.renderOnboarding(); window.__shown = []; const a = s.__uxOriginalAchievement ?? s.presentAchievementToast.bind(s); s.__uxOriginalAchievement = a; s.presentAchievementToast = (id, done) => { window.__shown.push('achievement'); return a(id, done); }; const m = s.milestones.present.bind(s.milestones); s.milestones.present = (def, done) => { if (def.id === 'immune-response') window.__shown.push('immune'); return m(def, done); }; s.newAchievements = ['first-contact']; s.showAchievementToast('first-contact'); s.showAchievementToast('first-contact'); const def = s.stageDirector.currentStage.milestones.find(m => m.atMs === 45000); s.milestones.show(def); s.milestones.show(def); }, step);
                await page.waitForTimeout(220);
                const first = await page.evaluate(() => ({ shown: window.__shown.slice(), tutorial: window.__game.scene.getScene('UI').onboardingContainer.visible }));
                assert.deepEqual(first.shown, ['achievement']);
                assert.equal(first.tutorial, false);
                if (reducedMotion === 'reduce')
                    assert.equal(await page.evaluate(() => window.__game.scene.getScene('Game').children.list.find(o => o.type === 'Container' && o.list?.some(t => t.text === 'ДОСТИЖЕНИЕ')).y), 185);
                await page.screenshot({ path: path.join(out, `ordered-${step + 1}-achievement-${reducedMotion}.png`) });
                await page.waitForFunction(() => window.__shown.includes('immune'));
                assert.equal(await page.evaluate(() => window.__game.scene.getScene('UI').onboardingContainer.visible), false);
                await page.waitForTimeout(190);
                await page.screenshot({ path: path.join(out, `ordered-${step + 1}-immune-${reducedMotion}.png`) });
                await page.waitForFunction(() => !window.__game.scene.getScene('Game').notificationRegion.occupied);
                await page.waitForTimeout(40);
                assert.equal(await page.evaluate(() => window.__game.scene.getScene('UI').onboardingContainer.visible), true);
                assert.deepEqual(await page.evaluate(() => window.__shown.slice()), ['achievement', 'immune']);
                console.log('ordering PASS', step + 1, reducedMotion);
            }
            // Existing context hint and boss presentation own the region temporarily.
            await page.evaluate(() => { const g=window.__game,s=g.scene.getScene('Game'),u=g.scene.getScene('UI');s.showAchievementToast('epidemic');u.showContextHint('HOST CELL CONTEXT',1800); });
            await page.waitForTimeout(1400);
            assert.equal(await page.evaluate(()=>window.__game.scene.getScene('Game').notificationRegion.occupied),true,'context hint must not consume hidden toast lifetime');
            await page.waitForFunction(()=>!window.__game.scene.getScene('Game').notificationRegion.occupied);
            await page.evaluate(()=>{const g=window.__game,s=g.scene.getScene('Game'),u=g.scene.getScene('UI');s.showAchievementToast('deep-dive');u.showBossReveal('QA BOSS','immune-prime',0xffaa33)});
            await page.waitForTimeout(100);
            assert.equal(await page.evaluate(()=>window.__game.scene.getScene('UI').onboardingContainer.visible),false);
            assert.equal(await page.evaluate(()=>window.__game.scene.getScene('Game').notificationRegion.occupied),true);
            await page.waitForFunction(()=>window.__game.scene.getScene('UI').activeBossReveals===0);
            await page.waitForFunction(()=>!window.__game.scene.getScene('Game').notificationRegion.occupied);
            console.log('context and boss suspension PASS',reducedMotion);
            // Background/resume: the same active message resumes; queue cannot expire unseen.
            await page.evaluate(() => { const g = window.__game, s = g.scene.getScene('Game'); s.showAchievementToast('continuous-flow'); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
            await page.waitForTimeout(1450);
            assert.equal(await page.evaluate(() => window.__game.scene.getScene('Game').notificationRegion.occupied), true);
            await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
            await page.waitForFunction(() => !window.__game.scene.getScene('Game').notificationRegion.occupied);
            // Mutation suspends an active message and its queued successor, then resumes them.
            await page.evaluate(() => { const s = window.__game.scene.getScene('Game'); s.showAchievementToast('stable-core'); s.milestones.show({ id: 'queued-transition', atMs: 0, title: 'QUEUED TRANSITION', subtitle: 'Must appear after mutation', color: 0xffaa33 }); s.queuedLevels = 1; });
            await page.waitForFunction(() => window.__game.scene.getScene('UI').modalOpen);
            await page.waitForTimeout(1450);
            assert.equal(await page.evaluate(() => window.__game.scene.getScene('Game').notificationRegion.occupied), true);
            assert.equal(await page.evaluate(() => window.__game.scene.getScene('UI').onboardingContainer.visible), false);
            await chooseOffer(page);
            await page.waitForFunction(() => !window.__game.scene.getScene('UI').modalOpen);
            await page.waitForFunction(() => !window.__game.scene.getScene('Game').notificationRegion.occupied);
            console.log('background and mutation PASS', reducedMotion);
            await page.evaluate(() => { const s = window.__game.scene.getScene('Game'); s.showAchievementToast('adaptation'); s.milestones.show({ id: 'result-pending', atMs: 0, title: 'DO NOT LEAK', subtitle: 'terminal boundary', color: 0xffaa33 }); s.finish(false); });
            await page.waitForFunction(() => window.__game.scene.getScene('UI').overShown);
            assert.equal(await page.evaluate(() => window.__game.scene.getScene('Game').notificationRegion.occupied), false);
            assert.equal(await page.evaluate(() => !!window.__game.scene.getScene('UI').onboardingContainer?.visible), false);
            assert.deepEqual(errors, []);
            console.log('result PASS', reducedMotion);
            await context.close();
        }
    }
    finally {
        await browser.close();
        await server.close();
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
