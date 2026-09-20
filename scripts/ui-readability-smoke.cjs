const fs = require('fs');
const path = require('path');

function browserDriver() {
  if (process.platform === 'win32') {
    return { chromium: require('playwright').chromium, executablePath: undefined };
  }
  const { chromium } = require('playwright-core');
  const executablePath = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find(fs.existsSync);
  if (!executablePath) throw new Error('Chrome not found');
  return { chromium, executablePath };
}

const CAPTURE_DIR = process.platform === 'win32'
  ? path.join(process.cwd(), '.tmp-browser-smoke')
  : '/tmp/browser-smoke';

const SAVE = {
  bestTimeMs: 430000,
  bestSurvivalMs: 430000,
  bestWinTimeMs: 312000,
  bestBoss1ClearMs: 312000,
  bestCampaignClearMs: 555000,
  bestKills: 2142,
  bestLevel: 18,
  runs: 15,
  muted: true,
  totalKills: 5560,
  achievements: [
    'first-contact',
    'continuous-flow',
    'stable-core',
    'adaptation',
    'deep-dive',
    'epidemic',
    'cleanup-500',
  ],
  evolutionsSeen: [],
  legendarySeen: ['zero-point', 'core-predator', 'last-carrier'],
  standardCampaignClears: 0,
  strainedCampaignClears: 0,
  bestStrainedCampaignClearMs: 0,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function styleFontSize(style) {
  const value = String(style?.fontSize ?? '0');
  return Number.parseFloat(value) || 0;
}

async function openCase(browser, size) {
  const ctx = await browser.newContext({
    viewport: size,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(({ width, height, save }) => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify(save));
    localStorage.setItem('ofeliya_control_mode_v1', 'dual-move');
    localStorage.setItem('ofeliya_difficulty_v1', 'standard');
    sessionStorage.clear();
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-readability-smoke',
      initDataUnsafe: { user: { id: 42, first_name: 'Олег' } },
      getViewportSize: async () => ({ width: String(width), height: String(height) }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  }, { ...size, save: SAVE });

  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await sleep(120);
  return { ctx, page, errors };
}

async function inspectMenu(page, size) {
  return page.evaluate(({ width, height }) => {
    const menu = window.__game.scene.getScene('Menu');
    const texts = menu.children.list.filter(
      (obj) => typeof obj?.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.05
    );
    const pick = (predicate) => {
      const obj = texts.find((candidate) => predicate(candidate.text));
      if (!obj) return null;
      const b = obj.getBounds();
      return {
        text: obj.text,
        size: parseFloat(String(obj.style?.fontSize ?? '0')) || 0,
        family: String(obj.style?.fontFamily ?? ''),
        color: String(obj.style?.color ?? ''),
        bounds: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    };
    const rows = [
      pick((t) => t.startsWith('Мутируй быстрее')),
      pick((t) => t.startsWith('Носитель:')),
      pick((t) => t.startsWith('Выживание ')),
      pick((t) => t === 'Базовый ритм кампании'),
      pick((t) => t.includes('оба стика')),
      pick((t) => t.startsWith('автоатака ·')),
      pick((t) => t.startsWith('звук:')),
      pick((t) => t.startsWith('КОДЕКС ')),
      pick((t) => t.startsWith('Двигай штамм')),
    ].filter(Boolean);
    const overflow = rows.filter(({ bounds }) =>
      bounds.left < 2 || bounds.right > width - 2 || bounds.top < 2 || bounds.bottom > height - 2
    );
    return { rows, overflow };
  }, size);
}

function assertMenu(contract, compact) {
  if (contract.rows.length < 8) {
    throw new Error('readability menu rows missing: ' + JSON.stringify(contract));
  }
  if (contract.overflow.length) {
    throw new Error('readability menu overflow: ' + JSON.stringify(contract.overflow));
  }
  const min = compact ? 11 : 12;
  const undersized = contract.rows.filter((row) => row.size < min);
  if (undersized.length) {
    throw new Error('readability menu undersized: ' + JSON.stringify(undersized));
  }
  const bodyRows = contract.rows.filter((row) =>
    row.text.startsWith('Мутируй') ||
    row.text.startsWith('Носитель:') ||
    row.text.startsWith('Выживание') ||
    row.text === 'Базовый ритм кампании' ||
    row.text.includes('оба стика') ||
    row.text.startsWith('автоатака ·') ||
    row.text.startsWith('звук:') ||
    row.text.startsWith('Двигай штамм')
  );
  const wrongFamily = bodyRows.filter((row) => !/system-ui/i.test(row.family));
  if (wrongFamily.length) {
    throw new Error('readability menu body font regression: ' + JSON.stringify(wrongFamily));
  }

  if (!compact) {
    const required = [
      [(row) => row.text.startsWith('Мутируй'), 15, 'menu hook body'],
      [(row) => row.text.startsWith('Носитель:'), 14, 'carrier'],
      [(row) => row.text.startsWith('Выживание'), 14, 'records'],
      [(row) => row.text === 'Базовый ритм кампании', 13, 'difficulty description'],
      [(row) => row.text.includes('оба стика'), 13, 'control description'],
      [(row) => row.text.startsWith('автоатака ·'), 13, 'start hint'],
    ];
    for (const [predicate, minSize, label] of required) {
      const row = contract.rows.find(predicate);
      if (!row || row.size < minSize) {
        throw new Error(`readability ${label} must be >= ${minSize}px: ${JSON.stringify(row)}`);
      }
    }
  }
}

async function openCodex(page) {
  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const codex = menu.children.list.find(
      (obj) => typeof obj?.text === 'string' && obj.text.startsWith('КОДЕКС ')
    );
    if (!codex) throw new Error('Codex entry missing');
    codex.emit('pointerup');
  });
  await page.waitForFunction(() => Boolean(window.__game.scene.getScene('Menu').codexOverlay));
  await sleep(60);
}

async function inspectCodex(page, size) {
  return page.evaluate(({ width, height }) => {
    const menu = window.__game.scene.getScene('Menu');
    const root = menu.codexOverlay;
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    visit(root);
    const texts = flat.filter(
      (obj) => typeof obj?.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.05
    );
    const rows = texts.map((obj) => {
      const b = obj.getBounds();
      return {
        text: obj.text,
        size: parseFloat(String(obj.style?.fontSize ?? '0')) || 0,
        family: String(obj.style?.fontFamily ?? ''),
        color: String(obj.style?.color ?? ''),
        bounds: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    });
    const important = rows.filter((row) =>
      row.text !== '×' &&
      row.text !== 'КОДЕКС · STRAIN-0' &&
      !row.text.startsWith('Codex фиксирует открытия')
    );
    const overflow = rows.filter(({ bounds }) =>
      bounds.left < 2 || bounds.right > width - 2 || bounds.top < 2 || bounds.bottom > height - 2
    );
    const activeLines = flat.filter(
      (obj) => obj?.type === 'Rectangle' && obj.visible && obj.height === 3 && (obj.alpha ?? 1) > 0.2
    ).length;
    return { rows, important, overflow, activeLines };
  }, size);
}

function assertCodex(contract, compact, pageName) {
  if (contract.overflow.length) {
    throw new Error(`readability Codex ${pageName} overflow: ${JSON.stringify(contract.overflow)}`);
  }
  if (contract.activeLines < 1) {
    throw new Error(`readability Codex ${pageName} active-tab underline missing`);
  }
  const min = compact ? 11 : 12;
  const undersized = contract.important.filter((row) => row.size < min);
  if (undersized.length) {
    throw new Error(`readability Codex ${pageName} undersized: ${JSON.stringify(undersized)}`);
  }
  const forbidden = contract.rows.filter((row) =>
    ['#59647c', '#65718b'].includes(row.color.toLowerCase())
  );
  if (forbidden.length) {
    throw new Error(`readability Codex ${pageName} old low-contrast colors remain: ${JSON.stringify(forbidden)}`);
  }
  const body = contract.rows.filter((row) =>
    row.text.includes('Продолжай развивать') ||
    row.text.includes('прохождений') ||
    row.text.startsWith('◆ ') ||
    row.text.startsWith('◇ ')
  );
  const wrongFamily = body.filter((row) => !/system-ui/i.test(row.family));
  if (wrongFamily.length) {
    throw new Error(`readability Codex ${pageName} body font regression: ${JSON.stringify(wrongFamily)}`);
  }
  if (!compact) {
    const tinyImportant = contract.important.filter((row) => row.size < 12);
    if (tinyImportant.length) {
      throw new Error(`readability Codex ${pageName} still has sub-12px important text: ${JSON.stringify(tinyImportant)}`);
    }
    const section = contract.rows.find((row) =>
      row.text === 'КРИТИЧЕСКИЕ МУТАЦИИ' || row.text === 'МАСТЕРСТВО КАМПАНИИ'
    );
    if (section && section.size < 15) {
      throw new Error(`readability Codex ${pageName} section heading too small: ${JSON.stringify(section)}`);
    }
  }
}

async function clickCodexTab(page, label) {
  await page.evaluate((target) => {
    const root = window.__game.scene.getScene('Menu').codexOverlay;
    const tab = root?.list?.find((obj) => obj?.type === 'Text' && obj.text === target);
    if (!tab) throw new Error('Codex tab missing: ' + target);
    tab.emit('pointerup');
  }, label);
  await sleep(50);
}

async function closeCodex(page) {
  await page.evaluate(() => {
    const menu = window.__game.scene.getScene('Menu');
    const root = menu.codexOverlay;
    const close = root?.list?.find((obj) => obj?.type === 'Text' && obj.text === '×');
    if (!close) throw new Error('Codex close missing');
    close.emit('pointerup');
  });
  await page.waitForFunction(() => !window.__game.scene.getScene('Menu').codexOverlay);
}

async function openMutation(page) {
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() =>
    window.__game.scene.isActive('Game') && window.__game.scene.isActive('UI')
  );
  await page.evaluate(() => {
    const gs = window.__game.scene.getScene('Game');
    gs.runState.stage.hp = 1000000;
    gs.runState.stage.maxHp = 1000000;
    gs.queuedLevels = 1;
    gs.awaitingChoice = false;
  });
  await page.waitForFunction(() => {
    const gs = window.__game.scene.getScene('Game');
    const ui = window.__game.scene.getScene('UI');
    return gs.pendingChoices?.length === 3 && ui.modalOpen && Boolean(ui.modal);
  }, null, { timeout: 4000 });
  await sleep(80);
}

async function inspectMutation(page, size) {
  return page.evaluate(({ width, height }) => {
    const ui = window.__game.scene.getScene('UI');
    const root = ui.modal;
    const flat = [];
    const visit = (obj) => {
      flat.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach(visit);
    };
    visit(root);
    const texts = flat.filter(
      (obj) => typeof obj?.text === 'string' && obj.visible !== false && (obj.alpha ?? 1) > 0.05
    );
    const rows = texts.map((obj) => {
      const b = obj.getBounds();
      return {
        text: obj.text,
        size: parseFloat(String(obj.style?.fontSize ?? '0')) || 0,
        family: String(obj.style?.fontFamily ?? ''),
        color: String(obj.style?.color ?? ''),
        bounds: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    });
    const overflow = rows.filter(({ bounds }) =>
      bounds.left < 2 || bounds.right > width - 2 || bounds.top < 2 || bounds.bottom > height - 2
    );
    const cards = root.list
      .filter((obj) => Array.isArray(obj?.list))
      .map((card) => {
        const bg = card.list.find((obj) => obj?.type === 'Rectangle' && obj.width > 250);
        const cardTexts = card.list.filter((obj) => typeof obj?.text === 'string');
        return bg
          ? {
              height: bg.height,
              textCount: cardTexts.length,
              minTextSize: Math.min(...cardTexts.map((obj) => parseFloat(String(obj.style?.fontSize ?? '0')) || 0)),
              bodySystemCount: cardTexts.filter((obj) => /system-ui/i.test(String(obj.style?.fontFamily ?? ''))).length,
            }
          : null;
      })
      .filter(Boolean);
    return { rows, overflow, cards };
  }, size);
}

function assertMutation(contract, compact) {
  if (contract.overflow.length) {
    throw new Error('readability mutation overflow: ' + JSON.stringify(contract.overflow));
  }
  if (contract.cards.length !== 3) {
    throw new Error('readability mutation card count: ' + JSON.stringify(contract.cards));
  }
  const expectedHeight = compact ? 112 : 136;
  if (contract.cards.some((card) => card.height < expectedHeight || card.minTextSize < (compact ? 11 : 12))) {
    throw new Error('readability mutation card typography: ' + JSON.stringify(contract.cards));
  }
  if (!compact && contract.cards.some((card) => card.bodySystemCount < 2)) {
    throw new Error('readability mutation body font missing: ' + JSON.stringify(contract.cards));
  }
  const longTitle = contract.rows.find((row) => row.text === 'МНОЖЕСТВЕННАЯ РЕПЛИКАЦИЯ');
  if (longTitle && (longTitle.bounds.left < 2 || longTitle.bounds.right > (compact ? 358 : 388))) {
    throw new Error('long mutation title must wrap inside the mobile viewport: ' + JSON.stringify(longTitle));
  }
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: process.platform === 'win32' ? [] : ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });

  for (const size of [
    { width: 390, height: 740, capture: true },
    { width: 360, height: 640, capture: false },
  ]) {
    const { ctx, page, errors } = await openCase(browser, size);
    const compact = size.height < 650;

    const menu = await inspectMenu(page, size);
    assertMenu(menu, compact);
    if (size.capture) {
      await page.locator('#game').screenshot({ path: path.join(CAPTURE_DIR, '10-readability-menu.png') });
    }

    await openCodex(page);
    let codex = await inspectCodex(page, size);
    assertCodex(codex, compact, 'mutations');
    if (size.capture) {
      await page.locator('#game').screenshot({ path: path.join(CAPTURE_DIR, '11-readability-codex-mutations.png') });
    }

    await clickCodexTab(page, 'МАСТЕРСТВО');
    codex = await inspectCodex(page, size);
    assertCodex(codex, compact, 'mastery');
    if (size.capture) {
      await page.locator('#game').screenshot({ path: path.join(CAPTURE_DIR, '12-readability-codex-mastery.png') });
    }

    await closeCodex(page);
    await openMutation(page);
    const mutation = await inspectMutation(page, size);
    assertMutation(mutation, compact);
    if (size.capture) {
      await page.locator('#game').screenshot({ path: path.join(CAPTURE_DIR, '13-readability-mutation.png') });
    }

    if (errors.length) throw new Error(`page errors ${size.width}x${size.height}: ${errors.join(' | ')}`);
    await ctx.close();
  }

  await browser.close();
  console.log('mobile UI readability smoke: ok (390x740, 360x640)');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
