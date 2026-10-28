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
  await page.goto(process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
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
    const toRow = (obj) => {
      if (!obj || typeof obj.text !== 'string' || obj.visible === false || (obj.alpha ?? 1) <= 0.05) return null;
      const b = obj.getBounds();
      return {
        name: obj.name,
        text: obj.text,
        size: parseFloat(String(obj.style?.fontSize ?? '0')) || 0,
        family: String(obj.style?.fontFamily ?? ''),
        color: String(obj.style?.color ?? ''),
        bounds: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    };
    const pick = (predicate) => toRow(texts.find((candidate) => predicate(candidate.text)));
    const pickNamed = (name) => toRow(menu.children.getByName(name));
    // The bands of the redesigned menu: the statement, the tagline, the record,
    // the two run-configuration cards, the navigation grid, the audio row and the
    // legal row.
    const rows = [
      pickNamed('ofeliya-menu-hook'),
      pickNamed('ofeliya-menu-subtitle'),
      pickNamed('ofeliya-menu-record'),
      pickNamed('ofeliya-menu-difficulty-selector-value'),
      pickNamed('ofeliya-menu-control-selector-value'),
      pickNamed('ofeliya-menu-difficulty-selector-desc'),
      pickNamed('ofeliya-menu-control-selector-desc'),
      pick((t) => t.includes('Музыка:')),
      pick((t) => t.startsWith('Звук:')),
      pick((t) => t.startsWith('Эффекты:')),
      pick((t) => t === 'РЕЙТИНГ'),
      pick((t) => t === 'ЗАДАЧИ ДНЯ'),
      pick((t) => t === 'КОДЕКС'),
      pick((t) => t === 'КОЛЛЕКЦИЯ'),
      pick((t) => t === 'ЛАБОРАТОРИЯ'),
      pick((t) => t === 'ШТАММЫ'),
      pick((t) => t === 'О приложении · Политика · Поддержка'),
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
  // The body text of the menu is the readable content: the tagline, the record,
  // the run-configuration cards, the audio row and the legal row. The statement
  // and the navigation labels are display elements and keep the display font.
  // The description of a run-configuration card is identified by its object,
  // not by its wording: the card shows the full copy when it fits and the
  // one-line variant of the same fact when it does not, and both are body
  // text of the same size.
  const bodyRows = contract.rows.filter((row) =>
    row.name === 'ofeliya-menu-subtitle' ||
    row.name === 'ofeliya-menu-record' ||
    row.name === 'ofeliya-menu-difficulty-selector-desc' ||
    row.name === 'ofeliya-menu-control-selector-desc' ||
    row.text.includes('Музыка:') ||
    row.text.startsWith('Звук:') ||
    row.text.startsWith('Эффекты:') ||
    row.text === 'О приложении · Политика · Поддержка'
  );
  const wrongFamily = bodyRows.filter((row) => !/system-ui/i.test(row.family));
  if (wrongFamily.length) {
    throw new Error('readability menu body font regression: ' + JSON.stringify(wrongFamily));
  }

  if (!compact) {
    const required = [
      [(row) => row.name === 'ofeliya-menu-hook', 15, 'menu statement'],
      [(row) => row.name === 'ofeliya-menu-subtitle', 13, 'menu tagline'],
      [(row) => row.name === 'ofeliya-menu-record', 12, 'menu record'],
      [(row) => row.name === 'ofeliya-menu-difficulty-selector-value', 13, 'difficulty value'],
      [(row) => row.name === 'ofeliya-menu-control-selector-value', 13, 'control value'],
      [(row) => row.name === 'ofeliya-menu-difficulty-selector-desc', 13, 'difficulty description'],
      [(row) => row.name === 'ofeliya-menu-control-selector-desc', 13, 'control description'],
      [(row) => row.text.includes('Музыка:'), 11, 'audio row'],
      [(row) => row.text === 'РЕЙТИНГ', 12, 'navigation grid'],
      [(row) => row.text === 'О приложении · Политика · Поддержка', 11, 'menu legal footer'],
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
    const codex = menu.children.getByName('ofeliya-menu-nav-codex');
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
        name: obj.name,
        text: obj.text,
        size: parseFloat(String(obj.style?.fontSize ?? '0')) || 0,
        family: String(obj.style?.fontFamily ?? ''),
        color: String(obj.style?.color ?? ''),
        bounds: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      };
    });
    // The frame title and the internal dock are navigation, not body text: they
    // keep their own sizes and are excluded from the readability floor.
    const important = rows.filter((row) =>
      row.text !== '×' &&
      row.name !== 'ofeliya-modal-title' &&
      !String(row.name ?? '').startsWith('ofeliya-meta-dock-')
    );
    // The internal dock is the only navigation of the codex: a stray footer link
    // would look like a destination that the codex does not have.
    const footer = rows.find((row) => row.text === 'КВЕСТЫ') ?? null;
    const overflow = rows.filter(({ bounds }) =>
      bounds.left < 2 || bounds.right > width - 2 || bounds.top < 2 || bounds.bottom > height - 2
    );
    const activeLines = flat.filter(
      (obj) => obj?.type === 'Rectangle' && obj.visible && obj.height === 3 && (obj.alpha ?? 1) > 0.2
    ).length;
    return { rows, important, overflow, activeLines, footer };
  }, size);
}

function assertCodex(contract, compact, pageName) {
  if (contract.overflow.length) {
    throw new Error(`readability Codex ${pageName} overflow: ${JSON.stringify(contract.overflow)}`);
  }
  if (contract.activeLines < 1) {
    throw new Error(`readability Codex ${pageName} active-tab underline missing`);
  }
  const min = compact ? 11 : 13;
  const undersized = contract.important.filter((row) => row.size < min);
  if (undersized.length) {
    throw new Error(`readability Codex ${pageName} undersized: ${JSON.stringify(undersized)}`);
  }
  if (contract.footer) {
    throw new Error(`readability Codex footer regression: ${JSON.stringify(contract.footer)}`);
  }
  const forbidden = contract.rows.filter((row) =>
    ['#59647c', '#65718b'].includes(row.color.toLowerCase())
  );
  if (forbidden.length) {
    throw new Error(`readability Codex ${pageName} old low-contrast colors remain: ${JSON.stringify(forbidden)}`);
  }
  const body = contract.rows.filter((row) =>
    row.text.includes('Продолжай развивать') ||
    row.text.includes('пройдено') ||
    row.text.startsWith('◆ ') ||
    row.text.startsWith('◇ ')
  );
  const wrongFamily = body.filter((row) => !/system-ui/i.test(row.family));
  if (wrongFamily.length) {
    throw new Error(`readability Codex ${pageName} body font regression: ${JSON.stringify(wrongFamily)}`);
  }
  if (!compact) {
    const tinyImportant = contract.important.filter((row) => row.size < 13);
    if (tinyImportant.length) {
      throw new Error(`readability Codex ${pageName} still has sub-13px important text: ${JSON.stringify(tinyImportant)}`);
    }
    const section = contract.rows.find((row) =>
      row.text === 'КРИТИЧЕСКИЕ МУТАЦИИ' || row.text === 'ПРОХОЖДЕНИЕ РЕЖИМОВ'
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
    // The shared frame owns a 44x44 close control; the cross is only its glyph.
    const close = root?.list?.find((obj) => obj?.name === 'ofeliya-modal-close-hit');
    if (!close) throw new Error('Codex close missing');
    close.emit('pointerup');
  });
  await page.waitForFunction(() => !window.__game.scene.getScene('Menu').codexOverlay);
}

async function openMutation(page) {
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(() =>
    // A fast first offer can pause Game before this polling callback runs.
    // The following gate still requires the real three-choice modal.
    (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')) &&
      window.__game.scene.isActive('UI')
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
  const expectedHeight = compact ? 124 : 148;
  if (contract.cards.some((card) => card.height < expectedHeight || card.minTextSize < (compact ? 11 : 12))) {
    throw new Error('readability mutation card typography: ' + JSON.stringify(contract.cards));
  }
  if (!compact && contract.cards.some((card) => card.bodySystemCount < 2)) {
    throw new Error('readability mutation body font missing: ' + JSON.stringify(contract.cards));
  }
  const progressRows = contract.rows.filter((row) => /^УРОВЕНЬ\s+\d+\s*\/\s*\d+$/.test(row.text));
  if (!compact && progressRows.some((row) => row.size < 13)) {
    throw new Error('readability mutation progress must be >= 13px: ' + JSON.stringify(progressRows));
  }
  const longTitle = contract.rows.find((row) => row.text === 'МНОЖЕСТВЕННЫЙ ЗАЛП');
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
    { width: 390, height: 620, capture: false },
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
