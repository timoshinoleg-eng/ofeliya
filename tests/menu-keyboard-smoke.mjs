import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

// One browser, sequential contexts: keep the 16 GB development machine comfortable.
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
let browser;
let activePage;
try {
  await server.listen();
  const executablePath = process.env.OFELIYA_CHROME_PATH || (process.platform === 'win32'
    ? undefined
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(existsSync));
  browser = await chromium.launch({ executablePath, headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'] });
  const url = server.resolvedUrls.local[0] + '?renderer=canvas&video=0';
  const order = ['СЛОЖНОСТЬ:', 'УПРАВЛЕНИЕ:', 'НАЧАТЬ ЗАРАЖЕНИЕ', 'муз·', 'звук:', 'эфф·',
    'СВОДКА', 'КОДЕКС', 'О ПРИЛОЖЕНИИ'];
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 740 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    activePage = page;
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.route('https://st.max.ru/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: '{"ok":false}' }));
    await page.addInitScript(() => {
      window.__keyboardEvents = [];
      window.addEventListener('keydown', event => {
        window.__keyboardEvents.push({ key: event.key, target: event.target.tagName,
          active: document.activeElement?.tagName, repeat: event.repeat });
      }, true);
      localStorage.setItem('ofeliya_save_v1', JSON.stringify({ runs: 5, muted: true }));
      localStorage.setItem('ofeliya_difficulty_v1', 'standard');
      localStorage.setItem('ofeliya_control_mode_v1', 'one-hand');
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const ready = () => page.waitForFunction(() => window.__game?.scene.isActive('Menu') &&
      document.querySelector('canvas')?.hasAttribute('aria-keyshortcuts'));
    await ready();
    const focus = async prefix => {
      await page.waitForFunction(prefix => document.querySelector('canvas').getAttribute('aria-label')?.startsWith(prefix), prefix);
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('canvas')), true);
      await page.waitForFunction(() => {
        const menu = window.__game.scene.getScene('Menu');
        const rings = menu.children.list.filter(item => item.name === 'ofeliya-menu-keyboard-focus');
        return rings.length === 1 && rings[0].commandBuffer.length > 0;
      });
    };
    const state = () => page.evaluate(() => ({
      difficulty: window.__game.registry.get('difficultyId'), control: window.__game.registry.get('controlMode'),
    }));
    const listenerCount = () => page.evaluate(() => window.__game.scene.getScene('Menu').input.keyboard.listenerCount('keydown'));
    assert.equal(await listenerCount(), 1);
    for (const prefix of order) { await page.keyboard.press('Tab'); await focus(prefix); }
    await page.keyboard.press('Shift+Tab'); await focus('КОДЕКС');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').codexOverlay));
    const codexState = await state();
    await page.keyboard.press('Tab'); await page.keyboard.press('Space');
    assert.deepEqual(await state(), codexState);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').codexOverlay);
    await focus('КОДЕКС');
    await page.keyboard.press('Tab'); await focus('О ПРИЛОЖЕНИИ');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#ofeliya-legal-overlay .legal-close').evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#ofeliya-legal-overlay a').first().evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space'); // native close button, no menu activation
    await page.waitForFunction(() => !document.getElementById('ofeliya-legal-overlay'));
    await focus('О ПРИЛОЖЕНИИ');
    await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    await focus('О ПРИЛОЖЕНИИ');
    await page.keyboard.press('Tab'); await focus('СЛОЖНОСТЬ:');
    const before = await state();
    await page.keyboard.press('Enter');
    assert.notEqual((await state()).difficulty, before.difficulty);
    await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    assert.equal((await state()).difficulty, before.difficulty, 'held key activates once');
    await page.keyboard.press('Tab'); await focus('УПРАВЛЕНИЕ:');
    await page.keyboard.press('Space');
    assert.equal((await state()).control, 'two-hand');
    await page.keyboard.press('Shift+Tab'); await focus('СЛОЖНОСТЬ:');

    // A native modal's input/button owns all keyboard defaults, even while menu is active.
    const modalState = await state();
    await page.evaluate(() => {
      const dialog = document.createElement('div'); dialog.id = 'keyboard-fixture';
      dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<input aria-label="fixture"><button>Fixture</button>';
      document.body.appendChild(dialog); dialog.querySelector('input').focus();
    });
    await page.keyboard.press('Enter'); await page.keyboard.press('Space'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('#keyboard-fixture button').evaluate(el => el === document.activeElement), true);
    assert.deepEqual(await state(), modalState);
    // Modal also blocks menu if canvas is programmatically focused.
    await page.locator('canvas').focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.deepEqual(await state(), modalState);
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      // Same JS task: Phaser's queue cannot be cleared by POST_STEP in between.
      // The ignored canvas Enter must not replay after the DOM modal disappears.
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      document.getElementById('keyboard-fixture').remove();
      canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    });
    assert.deepEqual(await state(), modalState, 'ignored DOM-modal event cannot replay into menu');
    await page.evaluate(() => {
      const video = document.createElement('div'); video.dataset.ofeliyaVideo = 'fixture';
      document.body.appendChild(video);
    });
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
    assert.deepEqual(await state(), modalState);
    await page.evaluate(() => document.querySelector('[data-ofeliya-video]').remove());

    // Reach every utility, activate volume/mute and verify live hit areas still match labels.
    await page.keyboard.press('ArrowDown'); await focus('УПРАВЛЕНИЕ:');
    await page.keyboard.press('ArrowDown'); await focus('НАЧАТЬ ЗАРАЖЕНИЕ');
    for (const prefix of ['муз·', 'звук:', 'эфф·']) {
      await page.keyboard.press('Tab'); await focus(prefix);
      const label = await page.locator('canvas').getAttribute('aria-label');
      await page.keyboard.press('Space');
      await page.waitForFunction(label => document.querySelector('canvas').getAttribute('aria-label') !== label, label);
      assert.equal(await page.evaluate(() => {
        const texts = window.__game.scene.getScene('Menu').children.list.filter(item =>
          typeof item.text === 'string' && /^(муз·|звук:|эфф·)/.test(item.text));
        return texts.every(item => item.input.hitArea.width === item.width && item.input.hitArea.height === item.height &&
          item.getBounds().left >= 0 && item.getBounds().right <= window.__game.scale.width);
      }), true, 'dynamic utility bounds/hit areas');
    }
    await page.keyboard.press('Tab'); await focus('СВОДКА'); await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').socialHub));
    await page.keyboard.press('Tab'); await page.keyboard.press('Space');
    assert.deepEqual(await state(), modalState);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('canvas')), true,
      'Phaser overlay keeps native canvas focus for Escape');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').socialHub);
    await focus('СВОДКА');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').socialHub));
    // Also exercise the existing pointer close control after opening with keyboard.
    const closePoint = await page.evaluate(() => {
      const root = window.__game.scene.getScene('Menu').children.list.find(item => item.list?.some(child => child.name === 'ofeliya-social-close-hit'));
      const bounds = root.list.find(item => item.name === 'ofeliya-social-close-hit').getBounds();
      const canvas = document.querySelector('canvas').getBoundingClientRect();
      return { x: canvas.x + bounds.centerX * canvas.width / window.__game.scale.width,
        y: canvas.y + bounds.centerY * canvas.height / window.__game.scale.height };
    });
    await page.mouse.click(closePoint.x, closePoint.y);
    await page.waitForFunction(() => !window.__game.scene.getScene('Menu').socialHub);

    // Explicit restarts plus real viewport resize must retain exactly one controller.
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => {
        const menu = window.__game.scene.getScene('Menu');
        window.__previousRing = menu.children.getByName('ofeliya-menu-keyboard-focus');
        menu.scene.restart();
      });
      await page.waitForFunction(() => window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-keyboard-focus') !== window.__previousRing);
      await ready();
      assert.equal(await listenerCount(), 1);
    }
    await page.evaluate(() => { window.__previousRing = window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-keyboard-focus'); });
    await page.setViewportSize({ width: viewport.width + 4, height: viewport.height + 8 });
    // Refresh Phaser's parent bounds explicitly after the real DOM resize. The
    // viewport adapter and Scale.RESIZE otherwise race over the cached parent size.
    // This test owns menu listener cleanup, not that independent viewport contract.
    await page.waitForFunction(width => document.getElementById('game').clientWidth === width, viewport.width + 4);
    await page.evaluate(() => { window.__game.scale.getParentBounds(); window.__game.scale.refresh(); });
    await page.waitForFunction(width => window.__game.scale.width === width, viewport.width + 4).catch(async error => {
      throw new Error('resize state: ' + JSON.stringify(await page.evaluate(() => ({
        inner: [innerWidth, innerHeight], scale: [window.__game.scale.width, window.__game.scale.height],
        host: document.getElementById('game').getBoundingClientRect().toJSON(),
      }))), { cause: error });
    });
    await ready();
    await page.waitForFunction(() => window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-keyboard-focus') !== window.__previousRing);
    assert.equal(await listenerCount(), 1);
    await page.keyboard.press('Tab'); await focus('СЛОЖНОСТЬ:');
    const restarted = await state(); await page.keyboard.press('Enter');
    assert.notEqual((await state()).difficulty, restarted.difficulty);
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await focus('НАЧАТЬ ЗАРАЖЕНИЕ');
    await page.evaluate(() => {
      window.__menuStarts = 0;
      window.__resumeStarts = [];
      window.__game.scene.getScene('Game').events.on('start', () => {
        window.__menuStarts++;
        window.__resumeStarts.push(Boolean(window.__game.registry.get('runCheckpointResume')));
      });
    });
    await page.keyboard.down('Enter'); await page.keyboard.down('Enter'); await page.keyboard.up('Enter');
    await page.waitForFunction(() => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI'));
    assert.equal(await page.evaluate(() => window.__menuStarts), 1, 'one actual Game start');
    assert.equal(await listenerCount(), 0, 'menu keyboard listener removed on shutdown');
    assert.equal(await page.locator('canvas').getAttribute('aria-keyshortcuts'), null);
    await page.keyboard.press('Tab'); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__game.scene.isActive('Game')), true);
    assert.equal(await page.evaluate(() => window.__menuStarts), 1);
    await page.waitForFunction(() => localStorage.getItem('ofeliya_run_checkpoint_v1'));
    // Real checkpoint from this run: optional New Run is registered between Resume and utilities.
    await page.evaluate(() => {
      const game = window.__game; game.scene.stop('UI'); game.scene.stop('Game'); game.scene.start('Menu');
    });
    await ready();
    await page.locator('canvas').focus();
    for (const prefix of ['СЛОЖНОСТЬ:', 'УПРАВЛЕНИЕ:', 'ПРОДОЛЖИТЬ ЗАБЕГ', 'НАЧАТЬ НОВЫЙ', 'муз·']) {
      await page.keyboard.press('Tab'); await focus(prefix);
    }
    await page.keyboard.press('Shift+Tab'); await focus('НАЧАТЬ НОВЫЙ');
    await page.keyboard.press('Shift+Tab'); await focus('ПРОДОЛЖИТЬ ЗАБЕГ');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => window.__game.scene.isActive('Game'));
    assert.equal(await page.evaluate(() => window.__menuStarts), 2, 'one actual resume start');
    await page.evaluate(() => {
      const game = window.__game; game.scene.stop('UI'); game.scene.stop('Game'); game.scene.start('Menu');
    });
    await ready();
    await page.locator('canvas').focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await focus('НАЧАТЬ НОВЫЙ');
    await page.evaluate(async () => {
      const { VideoInterstitial } = await import('/src/systems/VideoInterstitial.ts');
      const play = VideoInterstitial.play;
      window.__introCalls = 0;
      VideoInterstitial.play = function(id, options) {
        window.__introCalls++;
        window.__introCallbacks = options;
        return play.call(this, id, options);
      };
    });
    await page.keyboard.down('Space'); await page.keyboard.down('Space'); await page.keyboard.up('Space');
    await page.waitForFunction(() => window.__game.scene.isActive('Game'));
    // Exercise both late media callbacks against the actual menu launchOnce closure.
    await page.evaluate(() => { window.__introCallbacks.onFail(); window.__introCallbacks.onComplete(); });
    assert.equal(await page.evaluate(() => window.__introCalls), 1);
    assert.equal(await page.evaluate(() => window.__menuStarts), 3, 'New Run / duplicate intro callbacks start once');
    assert.deepEqual(await page.evaluate(() => window.__resumeStarts), [false, true, false]);
    if (viewport.width === 390) {
      // Existing checkpoint must not turn a social challenge into a Resume action.
      await page.goto(url + '&startapp=sz1_s_2n9c_26_4_9_l', { waitUntil: 'domcontentloaded' });
      await ready();
      await page.keyboard.press('Tab'); await focus('СЛОЖНОСТЬ:'); await page.keyboard.press('Enter');
      assert.equal((await state()).difficulty, 'standard', 'legacy challenge difficulty lock');
      await page.keyboard.press('Tab'); await focus('УПРАВЛЕНИЕ:'); await page.keyboard.press('Space');
      assert.equal((await state()).control, 'two-hand', 'legacy challenge permits control selection');
      await page.keyboard.press('Tab'); await focus('ПРИНЯТЬ ВЫЗОВ');
      await page.keyboard.press('Tab'); await focus('муз·'); // no checkpoint secondary action
      const challengeId = 'AbCdEf0123_-xyZ9';
      for (const valid of [true, false]) {
        await page.route(`**/api/duel/${challengeId}`, route => route.fulfill({ contentType: 'application/json',
          body: JSON.stringify(valid ? { ok: true, ranked: false, challenge: {
            challengeId, rulesetVersion: 3, campaignVersion: 2, runSeed: 'menu-keyboard-duel',
            difficultyId: 'standard', controlMode: 'dual-move', targetTimeMs: 600000,
            createdAt: Date.now() - 1000, expiresAt: Date.now() + 86400000,
          } } : { ok: false }),
        }));
        await page.goto(url + '&startapp=d3_' + challengeId, { waitUntil: 'domcontentloaded' });
        await ready();
        await page.waitForFunction(valid => window.__game.scene.getScene('Menu').children.getByName('ofeliya-menu-action').text ===
          (valid ? 'ПРИНЯТЬ ДУЭЛЬ' : 'НАЧАТЬ ОБЫЧНЫЙ ЗАБЕГ'), valid);
        await page.keyboard.press('Tab'); await focus('СЛОЖНОСТЬ:'); await page.keyboard.press('Enter');
        assert.equal((await state()).difficulty, valid ? 'standard' : 'strained', 'duel difficulty lock/fallback');
        await page.keyboard.press('Tab'); await focus('УПРАВЛЕНИЕ:'); await page.keyboard.press('Space');
        assert.equal((await state()).control, valid ? 'dual-move' : 'two-hand', 'duel control lock/fallback');
        await page.keyboard.press('Tab'); await focus(valid ? 'ПРИНЯТЬ ДУЭЛЬ' : 'НАЧАТЬ ОБЫЧНЫЙ ЗАБЕГ');
        await page.keyboard.press('Tab'); await focus('муз·');
        await page.unroute(`**/api/duel/${challengeId}`);
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS menu keyboard ${viewport.width}x${viewport.height}`);
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) console.error('keyboard failure state', await activePage.evaluate(() => ({
    focus: document.activeElement?.outerHTML.slice(0, 300), keys: window.__keyboardEvents?.slice(-12),
    overlays: Array.from(document.querySelectorAll('[role="dialog"], [data-ofeliya-video]')).map(el => el.outerHTML.slice(0, 100)),
    menuActive: window.__game?.scene.isActive('Menu'), gameActive: window.__game?.scene.isActive('Game'),
  })).catch(() => 'page unavailable'));
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
