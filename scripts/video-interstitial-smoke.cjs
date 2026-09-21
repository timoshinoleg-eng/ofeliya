const fs = require('fs');
const { chromium } = require('playwright-core');

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const VIEWPORT = { width: 390, height: 740 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function touchAt(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(35);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function startButtonCenter(page) {
  return page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    menu.children.list.forEach(visit);
    const text = flat.find((obj) => obj?.text === 'НАЧАТЬ ЗАРАЖЕНИЕ' && obj.visible !== false);
    if (!text) return null;
    const candidates = flat
      .filter((obj) => obj?.input?.enabled && typeof obj.getBounds === 'function')
      .map((obj) => ({ obj, bounds: obj.getBounds() }))
      .filter(({ bounds }) =>
        text.x >= bounds.left && text.x <= bounds.right && text.y >= bounds.top && text.y <= bounds.bottom
      )
      .sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
    const bounds = candidates[0]?.bounds;
    return bounds ? { x: Math.round(bounds.centerX), y: Math.round(bounds.centerY) } : null;
  });
}

async function makeContext(browser, mediaMode = 'native') {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ width, height, mediaMode }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-video-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Video', last_name: 'QA' } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };

    if (mediaMode === 'reject') {
      window.__mediaPlayCalls = 0;
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () {
        window.__mediaPlayCalls += 1;
        return Promise.reject(new Error('autoplay blocked by smoke'));
      };
    } else if (mediaMode === 'stall') {
      window.__mediaPlayCalls = 0;
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () {
        window.__mediaPlayCalls += 1;
        queueMicrotask(() => {
          this.dispatchEvent(new Event('playing'));
          this.dispatchEvent(new Event('waiting'));
        });
        return Promise.resolve();
      };
    } else if (mediaMode === 'transient') {
      window.__mediaPlayCalls = 0;
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () {
        window.__mediaPlayCalls += 1;
        const media = this;
        const setTime = (value) => {
          try {
            Object.defineProperty(media, 'currentTime', {
              configurable: true,
              writable: true,
              value,
            });
          } catch {}
        };
        queueMicrotask(() => media.dispatchEvent(new Event('playing')));
        window.setTimeout(() => {
          setTime(0.08);
          media.dispatchEvent(new Event('timeupdate'));
          media.dispatchEvent(new Event('waiting'));
        }, 90);
        window.setTimeout(() => {
          media.dispatchEvent(new Event('playing'));
          setTime(0.32);
          media.dispatchEvent(new Event('timeupdate'));
        }, 850);
        return Promise.resolve();
      };
    } else if (mediaMode === 'success') {
      window.__mediaPlayCalls = 0;
      HTMLMediaElement.prototype.load = function () {};
      HTMLMediaElement.prototype.play = function () {
        window.__mediaPlayCalls += 1;
        queueMicrotask(() => this.dispatchEvent(new Event('playing')));
        return Promise.resolve();
      };
    }
  }, { ...VIEWPORT, mediaMode });
  return ctx;
}

async function bootMenu(ctx, requests) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('request', (request) => {
    if (request.url().includes('/video/')) requests.push(request.url());
  });
  await page.goto('http://127.0.0.1:5173/?video=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  return { page, errors };
}

async function startGameDirect(page) {
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );
}

async function visibleUiText(page, wanted) {
  return page.evaluate((label) => {
    const ui = window.__game.scene.getScene('UI');
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    ui.children.list.forEach(visit);
    return flat.some((obj) => obj?.text === label && obj.visible !== false && obj.active !== false);
  }, wanted);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  // Assets must be real MP4 responses, but simply reaching Menu must request none of them.
  {
    const requests = [];
    const ctx = await makeContext(browser);
    const { page, errors } = await bootMenu(ctx, requests);
    await sleep(350);
    if (requests.length) throw new Error('cold boot requested video before intent: ' + requests.join(', '));
    for (const file of [
      '01_start_intro.mp4',
      '02_bloodstream_to_heart.mp4',
      '04_defeat.mp4',
      '06_victory_canonical.mp4',
    ]) {
      const res = await page.request.get('http://127.0.0.1:5173/video/' + file);
      if (res.status() !== 200) throw new Error(`video asset missing ${file}: HTTP ${res.status()}`);
      if (!(res.headers()['content-type'] || '').includes('video/mp4')) {
        throw new Error(`video MIME mismatch ${file}: ${res.headers()['content-type']}`);
      }
      if ((await res.body()).length < 100000) throw new Error(`video asset unexpectedly small: ${file}`);
    }
    if (errors.length) throw new Error('cold boot page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // Explicit play() rejection must never block a new run.
  {
    const requests = [];
    const ctx = await makeContext(browser, 'reject');
    const { page, errors } = await bootMenu(ctx, requests);
    const point = await startButtonCenter(page);
    if (!point) throw new Error('start button hit target missing');
    await touchAt(ctx, page, point);
    await page.waitForFunction(() => window.__game.scene.isActive('Game'));
    const calls = await page.evaluate(() => window.__mediaPlayCalls || 0);
    if (calls < 1) throw new Error('start intro did not attempt media play');
    if (errors.length) throw new Error('play rejection caused page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // A video that starts and then stalls must fall back inside the watchdog.
  {
    const requests = [];
    const ctx = await makeContext(browser, 'stall');
    const { page, errors } = await bootMenu(ctx, requests);
    const point = await startButtonCenter(page);
    if (!point) throw new Error('stall start button hit target missing');
    const startedAt = Date.now();
    await touchAt(ctx, page, point);
    await sleep(350);
    const flashState = await page.evaluate(() => {
      const overlay = document.querySelector('[data-ofeliya-video="startIntro"]');
      return overlay ? overlay.style.opacity : 'missing';
    });
    if (flashState !== '0') {
      throw new Error('unprogressed video became visible before fallback: ' + flashState);
    }
    await page.waitForFunction(() => window.__game.scene.isActive('Game'), null, { timeout: 2800 });
    const elapsed = Date.now() - startedAt;
    if (elapsed > 2600) throw new Error('stall fallback exceeded watchdog budget: ' + elapsed);
    if (errors.length) throw new Error('stall fallback caused page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // A short WebView buffering pause after real frame progress must recover, not flash-fallback.
  {
    const requests = [];
    const ctx = await makeContext(browser, 'transient');
    const { page, errors } = await bootMenu(ctx, requests);
    const point = await startButtonCenter(page);
    if (!point) throw new Error('transient-buffer start button hit target missing');
    await touchAt(ctx, page, point);
    await page.waitForSelector('[data-ofeliya-video="startIntro"]');
    await page.waitForFunction(() => {
      const overlay = document.querySelector('[data-ofeliya-video="startIntro"]');
      return overlay?.style.opacity === '1';
    }, null, { timeout: 1200 });
    await sleep(950);
    const stillPlaying = await page.evaluate(() => ({
      overlay: document.querySelectorAll('[data-ofeliya-video="startIntro"]').length,
      gameActive: window.__game.scene.isActive('Game'),
    }));
    if (stillPlaying.overlay !== 1 || stillPlaying.gameActive) {
      throw new Error('transient buffering incorrectly triggered fallback: ' + JSON.stringify(stillPlaying));
    }
    await page.evaluate(() => {
      document
        .querySelector('[data-ofeliya-video="startIntro"] video')
        ?.dispatchEvent(new Event('ended'));
    });
    await page.waitForFunction(() => window.__game.scene.isActive('Game'));
    if (errors.length) throw new Error('transient buffering caused page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // Repeated skip events must still complete exactly once.
  {
    const requests = [];
    const ctx = await makeContext(browser, 'success');
    const { page, errors } = await bootMenu(ctx, requests);
    const point = await startButtonCenter(page);
    if (!point) throw new Error('skip start button hit target missing');
    await touchAt(ctx, page, point);
    await page.waitForSelector('[data-ofeliya-video="startIntro"]');
    await page.evaluate(() => {
      const overlay = document.querySelector('[data-ofeliya-video="startIntro"]');
      overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      overlay.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });
    await page.waitForFunction(() => window.__game.scene.isActive('Game'));
    await sleep(180);
    const state = await page.evaluate(() => ({
      gameActive: window.__game.scene.isActive('Game'),
      menuActive: window.__game.scene.isActive('Menu'),
      overlays: document.querySelectorAll('[data-ofeliya-video]').length,
    }));
    if (!state.gameActive || state.menuActive || state.overlays !== 0) {
      throw new Error('skip idempotency failed: ' + JSON.stringify(state));
    }
    if (errors.length) throw new Error('skip caused page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  // Every P1 runtime path must survive a media 404 using the existing procedural flow.
  {
    const requests = [];
    const ctx = await makeContext(browser);
    await ctx.route('**/video/**', (route) => route.fulfill({ status: 404, body: '' }));
    const { page, errors } = await bootMenu(ctx, requests);
    await startGameDirect(page);

    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      gs.runState.stage.hp = 1_000_000;
      gs.runState.stage.maxHp = 1_000_000;
      gs.runState.stage.timeMs = gs.stageDirector.currentStage.durationMs;
      gs.handleStageEvents(gs.stageDirector.update(gs.runState.stage.timeMs));
      gs.wave.boss.takeDamage(Number.MAX_SAFE_INTEGER);
    });
    await page.waitForFunction(
      () => window.__game.scene.getScene('Game').stageDirector.phase === 'STAGE_TRANSITION',
      null,
      { timeout: 3500 }
    );
    await page.waitForFunction(
      () => window.__game.scene.getScene('Game').stageDirector.currentStage.id === 'heart',
      null,
      { timeout: 3800 }
    );
    if (!requests.some((url) => url.includes('02_bloodstream_to_heart.mp4'))) {
      throw new Error('Bloodstream -> Heart video path was never requested');
    }
    if (errors.length) throw new Error('transition 404 fallback page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  {
    const requests = [];
    const ctx = await makeContext(browser);
    await ctx.route('**/video/**', (route) => route.fulfill({ status: 404, body: '' }));
    const { page, errors } = await bootMenu(ctx, requests);
    await startGameDirect(page);
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      gs.finish(false);
      window.__game.scene.getScene('UI').update();
    });
    await page.waitForFunction(
      () => {
        const ui = window.__game.scene.getScene('UI');
        const flat = [];
        const visit = (obj) => {
          flat.push(obj);
          if (Array.isArray(obj?.list)) obj.list.forEach(visit);
        };
        ui.children.list.forEach(visit);
        return flat.some(
          (obj) =>
            typeof obj?.text === 'string' &&
            obj.text.replace(/\s+/g, ' ').trim() === 'ШТАММ УНИЧТОЖЕН' &&
            obj.visible !== false
        );
      },
      null,
      { timeout: 4500 }
    );
    if (!requests.some((url) => url.includes('04_defeat.mp4'))) {
      throw new Error('defeat video path was never requested');
    }
    if (errors.length) throw new Error('defeat 404 fallback page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  {
    const requests = [];
    const ctx = await makeContext(browser);
    await ctx.route('**/video/**', (route) => route.fulfill({ status: 404, body: '' }));
    const { page, errors } = await bootMenu(ctx, requests);
    await startGameDirect(page);
    await page.evaluate(() => {
      const gs = window.__game.scene.getScene('Game');
      gs.finish(true, 'campaign-complete');
      window.__game.scene.getScene('UI').update();
    });
    await page.waitForFunction(
      () => {
        const ui = window.__game.scene.getScene('UI');
        const flat = [];
        const visit = (obj) => {
          flat.push(obj);
          if (Array.isArray(obj?.list)) obj.list.forEach(visit);
        };
        ui.children.list.forEach(visit);
        return flat.some(
          (obj) =>
            typeof obj?.text === 'string' &&
            obj.text.replace(/\s+/g, ' ').trim() === 'ИММУНИТЕТ ПОДАВЛЕН' &&
            obj.visible !== false
        );
      },
      null,
      { timeout: 4500 }
    );
    if (!requests.some((url) => url.includes('06_victory_canonical.mp4'))) {
      throw new Error('victory video path was never requested');
    }
    if (errors.length) throw new Error('victory fallback page errors: ' + errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log('video interstitial browser smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
