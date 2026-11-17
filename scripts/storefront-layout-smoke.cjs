/**
 * Storefront layout smoke — геометрические пересечения витрины (P1-4).
 *
 * Проверяет в headless Chromium (dev-сервер на 127.0.0.1:5173, mock-провайдер):
 *  - все 9 карточек каталога присутствуют, тексты/бейджи/кнопки внутри карточки
 *    и попарно не пересекаются (заголовок, описание, тег, строки статуса
 *    пропуска, медальон, кнопка цены);
 *  - кегли не ниже readability-контракта: заголовки >= 16px, описания >= 11px;
 *  - шапка: «ВИТРИНА», «НАЗАД» и подпись режима не пересекаются и влезают
 *    в экран; кнопки действий >= 44px;
 *  - баннер pending-покупки (320x568): тексты и кнопка не пересекаются;
 *  - прокрутка: scrollLimit > 0, скролл до конца доводит последнюю карточку
 *    до низа контентной области, маска на месте;
 *  - resize: после смены вьюпорта сцена перестраивается и пересечений нет;
 *  - покупка пропуска (mock): оверлей успеха — заголовок и подзаголовок
 *    не пересекаются, сцена возвращается в ready.
 *  - P2-N4 (порог тапа): drag 12px с кнопки с отпуском над ней — покупки
 *    нет, тап по той же кнопке — покупка; drag 70px по фону — скролл.
 *  - CR3 (гейт пропуска): пока restore не завершён — кнопка пропуска
 *    '···' и тап не покупает; после known — покупка разрешена; при
 *    активном пропуске — «АКТИВЕН».
 *
 * Матрица: 320x520, 320x568, 360x640, 390x844, 412x915 x пропуск
 * активен/неактивен. Пропуск активен — seed ofeliya.meta.v1
 * (seasonPassUntilMs) до загрузки сцены.
 *
 * Запуск: NODE_PATH=<worktree>/node_modules node scripts/storefront-layout-smoke.cjs
 * (dev-сервер должен быть уже поднят: npx vite --port 5173 --strictPort).
 */
const fs = require('fs');
const { chromium } = require('playwright-core');

// Системный Chrome — приоритет (CI); fallback — bundled Chromium
// Playwright (паттерн scripts/art-world-geometry-smoke.cjs): в VM
// системного Chrome нет, а без него smoke не запускается вообще.
const chrome = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  chromium.executablePath(),
].find(fs.existsSync);
if (!chrome) throw new Error('Chrome not found');

const BASE = process.env.OFELIYA_DEV_URL || 'http://127.0.0.1:5173';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORTS = [
  { width: 320, height: 520 },
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];
const FLAGS = '?flag.storefront.variant=mock&flag.monetization.starter-pack=true';
const TOL = 1; // px — допуск на дробные границы Phaser getBounds

function overlaps(a, b, tol = TOL) {
  return (
    a.x < b.x + b.w - tol &&
    b.x < a.x + a.w - tol &&
    a.y < b.y + b.h - tol &&
    b.y < a.y + a.h - tol
  );
}
function inside(inner, outer, tol = TOL) {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}
function center(b) {
  return { x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) };
}

async function touchAt(ctx, page, point) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  await sleep(45);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// CR3: состояние кнопки пропуска — текст её лейбла и restoreState сцены.
// Лейбл '···' = кнопка заблокирована (покупка/неизвестное состояние),
// 'АКТИВЕН' = пропуск уже есть, иначе — цена (покупка разрешена).
async function passButtonState(page) {
  return page.evaluate(() => {
    const s = window.__game.scene.getScene('Storefront');
    let label = null;
    for (const item of s.listContainer.list) {
      if (item?.type !== 'Container') continue;
      const all = [];
      const visit = (o) => {
        all.push(o);
        if (Array.isArray(o?.list)) o.list.forEach(visit);
      };
      visit(item);
      if (!all.some((o) => o?.type === 'Text' && o.text === 'Сезонный пропуск — 30 дней')) continue;
      label = all.find((o) => o?.name === 'card-buy-label')?.text ?? null;
      break;
    }
    return { label, restoreState: s.restoreState ?? null };
  });
}

// CR3: проскроллить карточку пропуска в центр контентной области.
async function scrollPassIntoView(page) {
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('Storefront');
    const content = s.contentRect();
    const targetCenter = content.top + content.height / 2;
    let cardY = null;
    for (const item of s.listContainer.list) {
      if (item?.type !== 'Container') continue;
      const all = [];
      const visit = (o) => {
        all.push(o);
        if (Array.isArray(o?.list)) o.list.forEach(visit);
      };
      visit(item);
      if (all.some((o) => o?.type === 'Text' && o.text === 'Сезонный пропуск — 30 дней')) {
        const r = item.getBounds();
        cardY = r.y + r.height / 2;
        break;
      }
    }
    if (cardY !== null) s.applyScroll(s.scrollOffset + (cardY - targetCenter));
  });
  await sleep(150);
}

// P2-N4: drag касанием от from к to (шагами, как живой палец).
async function touchDrag(ctx, page, from, to, steps = 4) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }],
    });
    await sleep(15);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/**
 * Boot игры до готовой витрины. seed: {passActive, pending}.
 * Возвращает {ctx, page, errors}.
 */
async function bootStorefront(browser, viewport, seed) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.route('https://st.max.ru/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript((s) => {
    const meta = { seasonPassUntilMs: s.passActive ? Date.now() + 30 * 24 * 3600 * 1000 : 0 };
    localStorage.setItem('ofeliya.meta.v1', JSON.stringify(meta));
    if (s.pending) {
      localStorage.setItem(
        'ofeliya.payments.pending.v1',
        JSON.stringify([
          {
            nonce: 'qa-pending-1',
            productId: 'currency.rna-pack-s',
            stars: 35,
            createdAt: Date.now(),
            attempts: 0,
          },
        ])
      );
    }
  }, seed);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(BASE + '/' + FLAGS, { waitUntil: 'domcontentloaded' });
  // P3-N3: явное ожидание готовности игры до обращения к window.__game
  // (флейк: evaluate падал с window.__game undefined, когда игра ещё
  // не поднялась; отдельный wait даёт понятную стадию отказа).
  await page.waitForFunction(() => window.__game && window.__game.scene, null, { timeout: 15000 });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'), null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__game.scene.getScene('Menu').scene.start('Storefront');
  });
  await page.waitForFunction(
    () =>
      window.__game.scene.isActive('Storefront') &&
      window.__game.scene.getScene('Storefront').state === 'ready',
    null,
    { timeout: 15000 }
  );
  await page.waitForFunction(() => document.fonts?.ready.then(() => true) ?? true, null, {
    timeout: 5000,
  }).catch(() => {});
  await sleep(300);
  return { ctx, page, errors };
}

/**
 * Извлечь геометрию витрины из живой сцены. Идентификация — по содержимому
 * (тексты каталога), а не по именам объектов: тест должен ловить наложения
 * и на старой компоновке (RED), и на новой (GREEN).
 */
async function extractGeometry(page) {
  return page.evaluate(() => {
    const scene = window.__game.scene.getScene('Storefront');
    const b = (o) => {
      const r = o.getBounds();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const flat = (obj, out) => {
      out.push(obj);
      if (Array.isArray(obj?.list)) obj.list.forEach((c) => flat(c, out));
      return out;
    };
    const products = scene.products.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      tag: p.tag ?? null,
      kind: p.kind,
    }));
    const content = scene.contentRect();

    // --- chrome (прямые дети root) ---
    const chrome = {};
    for (const obj of scene.root.list) {
      if (obj?.type === 'Text' && obj.text === 'ВИТРИНА') {
        chrome.title = { bounds: b(obj), fontSize: parseInt(obj.style.fontSize, 10) };
      }
      if (obj?.type === 'Text' && obj.text === '‹ НАЗАД') chrome.backLabel = b(obj);
      if (obj?.type === 'Text' && /тестовый режим|Telegram Stars|рельс MAX/.test(obj.text || '')) {
        chrome.mode = { bounds: b(obj), text: obj.text };
      }
    }
    if (chrome.backLabel) {
      const c = { x: chrome.backLabel.x + chrome.backLabel.w / 2, y: chrome.backLabel.y + chrome.backLabel.h / 2 };
      const bg = scene.root.list.find(
        (o) =>
          o?.type === 'Rectangle' &&
          Math.abs(o.x - c.x) < 2 &&
          Math.abs(o.y - c.y) < 2 &&
          o.input?.enabled
      );
      if (bg) chrome.back = b(bg);
    }

    // --- список: карточки и баннеры ---
    const list = scene.listContainer;
    const cards = [];
    const banners = [];
    const isPrice = (t) => /^\d+ ₽$/.test(t) || /^\d+ ★$/.test(t) || t === '···' || t === 'АКТИВЕН';
    for (const item of list?.list ?? []) {
      if (item?.type !== 'Container') continue;
      const all = flat(item, []);
      const texts = all.filter((o) => o?.type === 'Text');
      const rects = all.filter((o) => o?.type === 'Rectangle');
      const product = products.find((p) => texts.some((t) => t.text === p.title));
      if (!product) {
        // Баннер (pending/sync/collab/invite): лейбл, подтекст, опционально кнопка.
        const bg = rects.slice().sort((r1, r2) => r2.width * r2.height - r1.width * r1.height)[0];
        const btnLabel = texts.find((t) => ['ПРОВЕРИТЬ', 'ПОВТОРИТЬ', 'ПРИГЛАСИТЬ'].includes(t.text));
        const btn =
          btnLabel &&
          rects.find((r) => {
            if (r === bg) return false;
            const rb = r.getBounds();
            const lb = btnLabel.getBounds();
            const cx = lb.x + lb.width / 2;
            const cy = lb.y + lb.height / 2;
            return cx >= rb.x && cx <= rb.x + rb.width && cy >= rb.y && cy <= rb.y + rb.height;
          });
        banners.push({
          label: texts[0] ? { text: texts[0].text, bounds: b(texts[0]) } : null,
          sub: texts[1] ? { text: texts[1].text, bounds: b(texts[1]) } : null,
          button: btn ? b(btn) : null,
          buttonLabel: btnLabel ? b(btnLabel) : null,
          bg: bg ? b(bg) : null,
        });
        continue;
      }
      const bg = rects.slice().sort((r1, r2) => r2.width * r2.height - r1.width * r1.height)[0];
      const title = texts.find((t) => t.text === product.title);
      const desc = texts.find((t) => t.text === product.description);
      const tag = product.tag ? texts.find((t) => t.text === product.tag) : null;
      const buyLabel = texts.find((t) => isPrice(t.text));
      const buyBtn =
        buyLabel &&
        rects.find((r) => {
          if (r === bg) return false;
          const rb = r.getBounds();
          const lb = buyLabel.getBounds();
          const cx = lb.x + lb.width / 2;
          const cy = lb.y + lb.height / 2;
          return cx >= rb.x && cx <= rb.x + rb.width && cy >= rb.y && cy <= rb.y + rb.height;
        });
      const medallion = all.find(
        (o) => o?.type === 'Container' && o.list?.some((c) => c?.type === 'Arc')
      );
      const status = texts
        .filter((t) => t !== title && t !== desc && t !== tag && t !== buyLabel)
        .map((t) => ({ text: t.text, bounds: b(t) }));
      cards.push({
        id: product.id,
        kind: product.kind,
        bg: bg ? b(bg) : null,
        title: title ? { bounds: b(title), fontSize: parseInt(title.style.fontSize, 10) } : null,
        desc: desc ? { bounds: b(desc), fontSize: parseInt(desc.style.fontSize, 10) } : null,
        tag: tag ? b(tag) : null,
        buyButton: buyBtn ? b(buyBtn) : null,
        buyLabel: buyLabel ? b(buyLabel) : null,
        medallion: medallion ? b(medallion) : null,
        status,
      });
    }

    // --- success overlay (если есть) ---
    let overlay = null;
    const emblem = scene.root.list.find(
      (o) => o?.type === 'Container' && o.depth === 20 && o.list?.length
    );
    if (emblem) {
      const texts = flat(emblem, []).filter((o) => o?.type === 'Text');
      overlay = texts.map((t) => ({ text: t.text, bounds: b(t) }));
    }

    return {
      state: scene.state,
      products,
      content,
      scroll: { limit: scene.scrollLimit, offset: scene.scrollOffset },
      masked: !!list?.mask,
      chrome,
      cards,
      banners,
      overlay,
      screen: { w: scene.scale.width, h: scene.scale.height },
    };
  });
}

async function scrollGeometry(page) {
  return page.evaluate(() => {
    const scene = window.__game.scene.getScene('Storefront');
    const bgs = [];
    for (const item of scene.listContainer?.list ?? []) {
      if (item?.type !== 'Container') continue;
      const rects = [];
      const visit = (o) => {
        if (o?.type === 'Rectangle') rects.push(o);
        if (Array.isArray(o?.list)) o.list.forEach(visit);
      };
      visit(item);
      const bg = rects.slice().sort((r1, r2) => r2.width * r2.height - r1.width * r1.height)[0];
      if (bg) {
        const r = bg.getBounds();
        bgs.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return { bgs, content: scene.contentRect(), scroll: { limit: scene.scrollLimit, offset: scene.scrollOffset } };
  });
}

/** Все проверки геометрии одного кадра; failures — накопитель строк. */
function checkFrame(g, label, failures) {
  const fail = (msg) => failures.push(`${label}: ${msg}`);

  // --- chrome ---
  const c = g.chrome;
  if (!c.title) fail('chrome: нет заголовка ВИТРИНА');
  if (!c.back) fail('chrome: нет кнопки НАЗАД');
  if (!c.mode) fail('chrome: нет подписи режима');
  if (c.title && c.back) {
    if (overlaps(c.title.bounds, c.back)) fail('chrome: НАЗАД пересекается с ВИТРИНА');
    if (c.back.w < 44 || c.back.h < 44) fail(`chrome: кнопка НАЗАД ${c.back.w}x${c.back.h} < 44px`);
  }
  if (c.title && c.mode && overlaps(c.title.bounds, c.mode.bounds)) {
    fail('chrome: подпись режима пересекается с ВИТРИНА');
  }
  if (c.back && c.mode && overlaps(c.back, c.mode.bounds)) {
    fail('chrome: подпись режима пересекается с НАЗАД');
  }
  for (const [name, box] of [
    ['ВИТРИНА', c.title?.bounds],
    ['НАЗАД', c.back],
    ['режим', c.mode?.bounds],
  ]) {
    if (box && (box.x < -TOL || box.y < -TOL || box.x + box.w > g.screen.w + TOL || box.y + box.h > g.screen.h + TOL)) {
      fail(`chrome: ${name} выходит за экран ${JSON.stringify(box)}`);
    }
  }

  // --- карточки ---
  if (g.cards.length !== 9) fail(`карточек ${g.cards.length}, ожидалось 9`);
  const seen = new Set();
  for (const card of g.cards) {
    const L = `[${card.id}]`;
    if (seen.has(card.id)) fail(`${L}: дубль карточки`);
    seen.add(card.id);
    if (!card.bg) {
      fail(`${L}: нет фона карточки`);
      continue;
    }
    if (!card.title) fail(`${L}: нет заголовка`);
    if (!card.desc) fail(`${L}: нет описания`);
    if (!card.buyButton) fail(`${L}: нет кнопки цены`);
    if (card.title && card.title.fontSize < 16) {
      fail(`${L}: заголовок ${card.title.fontSize}px < 16px`);
    }
    if (card.desc && card.desc.fontSize < 11) {
      fail(`${L}: описание ${card.desc.fontSize}px < 11px`);
    }
    if (card.buyButton && (card.buyButton.w < 44 || card.buyButton.h < 44)) {
      fail(`${L}: кнопка цены ${card.buyButton.w}x${card.buyButton.h} < 44px`);
    }
    const parts = [];
    if (card.title) parts.push(['заголовок', card.title.bounds]);
    if (card.desc) parts.push(['описание', card.desc.bounds]);
    if (card.tag) parts.push(['тег', card.tag]);
    if (card.buyButton) parts.push(['кнопка', card.buyButton]);
    if (card.medallion) parts.push(['медальон', card.medallion]);
    card.status.forEach((s, i) => parts.push([`статус${i + 1} «${s.text.slice(0, 24)}»`, s.bounds]));
    for (const [name, box] of parts) {
      if (!inside(box, card.bg)) fail(`${L}: ${name} выходит за границы карточки ${JSON.stringify(box)}`);
    }
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        if (overlaps(parts[i][1], parts[j][1])) {
          fail(`${L}: пересечение «${parts[i][0]}» x «${parts[j][0]}»`);
        }
      }
    }
    if (card.buyLabel && card.buyButton && !inside(card.buyLabel, card.buyButton, 2)) {
      fail(`${L}: подпись цены выходит за кнопку`);
    }
    // У пропуска — обе строки статуса на месте и не пересекаются между собой.
    if (card.kind === 'season_pass' && card.status.length < 2) {
      fail(`${L}: строк статуса ${card.status.length}, ожидалось 2`);
    }
  }
  // Карточки попарно не пересекаются (зазор >= 0).
  for (let i = 0; i < g.cards.length; i++) {
    for (let j = i + 1; j < g.cards.length; j++) {
      if (g.cards[i].bg && g.cards[j].bg && overlaps(g.cards[i].bg, g.cards[j].bg, 0.5)) {
        fail(`${label}: карточки ${g.cards[i].id} x ${g.cards[j].id} пересекаются`);
      }
    }
  }

  // --- баннеры ---
  for (const [i, bn] of g.banners.entries()) {
    const L = `[баннер${i} «${bn.label?.text?.slice(0, 20) ?? ''}»]`;
    if (!bn.bg) {
      fail(`${L}: нет фона`);
      continue;
    }
    const parts = [];
    if (bn.label) parts.push(['лейбл', bn.label.bounds]);
    if (bn.sub) parts.push(['подтекст', bn.sub.bounds]);
    if (bn.button) parts.push(['кнопка', bn.button]);
    for (const [name, box] of parts) {
      if (!inside(box, bn.bg)) fail(`${L}: ${name} выходит за границы баннера`);
    }
    for (let a = 0; a < parts.length; a++) {
      for (let bIdx = a + 1; bIdx < parts.length; bIdx++) {
        if (overlaps(parts[a][1], parts[bIdx][1])) {
          fail(`${L}: пересечение «${parts[a][0]}» x «${parts[bIdx][0]}»`);
        }
      }
    }
    if (bn.button && (bn.button.w < 44 || bn.button.h < 44)) {
      fail(`${L}: кнопка ${bn.button.w}x${bn.button.h} < 44px`);
    }
  }

  if (!g.masked) fail(`${label}: у списка нет маски`);
}

async function checkScroll(page, label, failures) {
  const before = await scrollGeometry(page);
  if (before.scroll.limit <= 0) {
    failures.push(`${label}: scrollLimit ${before.scroll.limit} — список не скроллится`);
    return;
  }
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('Storefront');
    s.applyScroll(s.scrollLimit);
  });
  await sleep(120);
  const after = await scrollGeometry(page);
  const contentBottom = after.content.top + after.content.height;
  const last = after.bgs[after.bgs.length - 1];
  if (!last) {
    failures.push(`${label}: после скролла нет карточек`);
    return;
  }
  if (Math.abs(last.y + last.h - contentBottom) > 2) {
    failures.push(
      `${label}: низ последней карточки ${Math.round(last.y + last.h)} != низ контента ${Math.round(contentBottom)}`
    );
  }
  if (after.bgs[0].y >= after.content.top - 1) {
    failures.push(`${label}: после скролла до конца первая карточка всё ещё видна целиком`);
  }
  await page.evaluate(() => window.__game.scene.getScene('Storefront').applyScroll(0));
  await sleep(120);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const failures = [];
  let cases = 0;
  // CR-R3-10/11: фильтр кейсов для точечного прогона:
  // STOREFRONT_SMOKE_CASE=partially-masked-button-tap — только кейсы,
  // чья метка содержит подстроку. Без фильтра — полный прогон.
  const caseFilter = process.env.STOREFRONT_SMOKE_CASE || '';
  // P3-N3: per-case catch — один флейк (например, window.__game undefined
  // на 10-м кейсе) больше не убивает оставшиеся кейсы: исключение кейса
  // записывается как failure с именем кейса, прогон продолжается,
  // в конце — сводка по кейсам, exit 1 при любом провале.
  const caseResults = [];
  async function runCase(label, fn) {
    if (caseFilter && !label.includes(caseFilter)) return;
    cases += 1;
    const before = failures.length;
    try {
      await fn();
    } catch (error) {
      failures.push(`${label}: EXCEPTION ${error instanceof Error ? error.message : String(error)}`);
    }
    const n = failures.length - before;
    caseResults.push({ label, failures: n });
    console.log(`  case ${label}: ${n} failure(s)`);
  }

  // Матрица: вьюпорт x состояние пропуска.
  for (const vp of VIEWPORTS) {
    for (const passActive of [false, true]) {
      const label = `${vp.width}x${vp.height} pass=${passActive ? 'active' : 'inactive'}`;
      await runCase(label, async () => {
        const { ctx, page, errors } = await bootStorefront(browser, vp, { passActive });
        try {
          const g = await extractGeometry(page);
          checkFrame(g, label, failures);
          await checkScroll(page, label, failures);
          if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
          if (failures.some((f) => f.startsWith(label))) {
            await page.screenshot({ path: `/tmp/storefront-layout-fail-${vp.width}x${vp.height}-${passActive ? 'active' : 'inactive'}.png` });
          }
        } finally {
          await ctx.close();
        }
      });
    }
  }

  // Баннер pending-покупки на самом узком экране.
  await runCase('320x568 pending-banner', async () => {
    const label = '320x568 pending-banner';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 320, height: 568 }, { passActive: false, pending: true });
    try {
      const g = await extractGeometry(page);
      if (g.banners.length === 0) failures.push(`${label}: баннер pending-покупки не показался`);
      checkFrame(g, label, failures);
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // Невидимая кнопка: карточка уехала за маску вверх — тап по её кнопке
  // (она всё ещё хит-тестится Phaser, маска инпут не режет) не должен
  // начинать покупку.
  await runCase('masked-button-tap 390x844', async () => {
    const label = 'masked-button-tap 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        s.applyScroll(s.scrollLimit);
      });
      await sleep(150);
      const g = await extractGeometry(page);
      const top = g.content.top;
      const victim = g.cards.find(
        (c) => c.buyButton && c.buyButton.y + c.buyButton.h / 2 > 8 && c.buyButton.y + c.buyButton.h / 2 < top - 8
      );
      if (!victim) {
        console.log(`  case ${label}: skipped (no button landed in the chrome strip)`);
      } else {
        await touchAt(ctx, page, center(victim.buyButton));
        await sleep(600);
        const st = await page.evaluate(() => {
          const s = window.__game.scene.getScene('Storefront');
          return { state: s.state, lastBought: s.lastBought?.id ?? null };
        });
        if (st.state !== 'ready' || st.lastBought) {
          failures.push(
            `${label}: тап по невидимой кнопке ${victim.id} начал покупку (state=${st.state}, lastBought=${st.lastBought})`
          );
        }
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // CR-R3-11: кнопка, чей центр внутри контента, а верх — за маской:
  // тап по невидимой (замаскированной) части в шапке не должен покупать.
  // Позиционирование детерминированное: скролл считается из геометрии
  // так, чтобы центр кнопки был на 7px внутри контента (верх на ~15px
  // выше верха контента при высоте кнопки 44px). Зонд обязан достичь
  // страддла — иначе кейс падает, а не пропускается.
  await runCase('partially-masked-button-tap 390x844', async () => {
    const label = 'partially-masked-button-tap 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      const g0 = await extractGeometry(page);
      const card0 = g0.cards.find((c) => c.buyButton);
      if (!card0?.buyButton) {
        failures.push(`${label}: кнопка покупки не найдена`);
        return;
      }
      const top0 = g0.content.top;
      const centerY0 = card0.buyButton.y + card0.buyButton.h / 2;
      await page.evaluate((delta) => {
        const s = window.__game.scene.getScene('Storefront');
        s.applyScroll(s.scrollOffset + delta);
      }, centerY0 - (top0 + 7));
      await sleep(150);
      const g = await extractGeometry(page);
      const card = g.cards.find((c) => c.id === card0.id);
      const top = g.content.top;
      const btn = card?.buyButton;
      if (!btn) {
        failures.push(`${label}: кнопка ${card0.id} пропала после скролла`);
        return;
      }
      const btnTop = btn.y;
      const btnCenterY = btn.y + btn.h / 2;
      if (!(btnTop < top - 8 && btnCenterY > top + 2 && btnCenterY < top + 12)) {
        failures.push(
          `${label}: зонд невалиден — кнопка не страддлит верх контента (top=${top}, btnTop=${btnTop}, center=${btnCenterY})`
        );
        return;
      }
      // Инпут частично замаскированной кнопки должен быть выключен.
      const inputEnabled = await page.evaluate((want) => {
        const s = window.__game.scene.getScene('Storefront');
        for (const b of s.listButtons) {
          if (!b.input) continue;
          const r = b.getBounds();
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          if (Math.abs(cx - want.cx) < 1 && Math.abs(cy - want.cy) < 1) return b.input.enabled;
        }
        return null;
      }, { cx: btn.x + btn.w / 2, cy: btnCenterY });
      if (inputEnabled === null) {
        failures.push(`${label}: кнопка ${card.id} не найдена в listButtons`);
        return;
      }
      if (inputEnabled) {
        failures.push(`${label}: инпут частично замаскированной кнопки ${card.id} включён`);
      }
      // Тап по невидимой части кнопки — в полосе шапки над контентом.
      await touchAt(ctx, page, { x: Math.round(btn.x + btn.w / 2), y: Math.round(top - 8) });
      await sleep(600);
      const st = await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        return { state: s.state, lastBought: s.lastBought?.id ?? null };
      });
      if (st.state !== 'ready' || st.lastBought) {
        failures.push(
          `${label}: тап по невидимой части кнопки ${card.id} начал покупку (state=${st.state}, lastBought=${st.lastBought})`
        );
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // Resize: 390x844 -> 320x568, сцена перестраивается без наложений.
  await runCase('resize 390x844->320x568', async () => {
    const label = 'resize 390x844->320x568';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      await page.evaluate(() => {
        window.__storeRootBefore = window.__game.scene.getScene('Storefront').root;
      });
      await page.setViewportSize({ width: 320, height: 568 });
      let rebuilt = true;
      try {
        await page.waitForFunction(
          () => {
            const s = window.__game.scene.getScene('Storefront');
            return s.root !== window.__storeRootBefore && s.state === 'ready' && !!s.listContainer;
          },
          null,
          { timeout: 15000 }
        );
      } catch {
        rebuilt = false;
        failures.push(`${label}: сцена не перестроилась после resize (root не сменился)`);
      }
      if (rebuilt) {
        await sleep(300);
        const g = await extractGeometry(page);
        checkFrame(g, label, failures);
        await checkScroll(page, label, failures);
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // Покупка пропуска (mock): оверлей успеха без наложений, возврат в ready.
  await runCase('buy season-pass 390x844', async () => {
    const label = 'buy season-pass 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      // Скролл к карточке пропуска (7-я в списке, за пределами вьюпорта).
      await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        const content = s.contentRect();
        const targetCenter = content.top + content.height / 2;
        let cardY = null;
        for (const item of s.listContainer.list) {
          if (item?.type !== 'Container') continue;
          const all = [];
          const visit = (o) => {
            all.push(o);
            if (Array.isArray(o?.list)) o.list.forEach(visit);
          };
          visit(item);
          if (all.some((o) => o?.type === 'Text' && o.text === 'Сезонный пропуск — 30 дней')) {
            const r = item.getBounds();
            cardY = r.y + r.height / 2;
            break;
          }
        }
        if (cardY !== null) s.applyScroll(s.scrollOffset + (cardY - targetCenter));
      });
      await sleep(150);
      const g = await extractGeometry(page);
      const pass = g.cards.find((c) => c.id === 'season-pass.basic-30d');
      if (!pass?.buyButton) {
        failures.push(`${label}: кнопка покупки пропуска не найдена`);
      } else {
        await touchAt(ctx, page, center(pass.buyButton));
        let success = true;
        try {
          await page.waitForFunction(
            () => window.__game.scene.getScene('Storefront').state === 'success',
            null,
            { timeout: 10000 }
          );
        } catch {
          success = false;
          failures.push(`${label}: после покупки пропуска нет состояния success`);
        }
        if (!success) {
          // no-op: failure уже записан, пропускаем проверки оверлея
        } else {
        await sleep(150);
        const g2 = await extractGeometry(page);
        const ov = g2.overlay ?? [];
        const title = ov.find((t) => t.text === 'Сезонный пропуск — 30 дней');
        const sub = ov.find((t) => t.text === 'Выдано. Приятной мутации!');
        if (!title || !sub) {
          failures.push(`${label}: оверлей успеха без заголовка/подзаголовка (${JSON.stringify(ov.map((t) => t.text))})`);
        } else {
          if (overlaps(title.bounds, sub.bounds)) {
            failures.push(`${label}: заголовок оверлея пересекается с подзаголовком`);
          }
          for (const [name, box] of [['заголовок', title.bounds], ['подзаголовок', sub.bounds]]) {
            if (box.x < 0 || box.x + box.w > g2.screen.w || box.y < 0 || box.y + box.h > g2.screen.h) {
              failures.push(`${label}: ${name} оверлея выходит за экран`);
            }
          }
        }
        // Закрытие оверлея — тапом по димму (тот же dismiss, что и у
        // таймера 2400 мс). Таймер в headless ждать нельзя: при ~8 fps на
        // SwiftShader игровое время (smoothStep) идёт в разы медленнее
        // стены, и 2400 мс игрового времени — это ~20 с стены.
        await touchAt(ctx, page, { x: 20, y: 20 });
        try {
          await page.waitForFunction(
            () => window.__game.scene.getScene('Storefront').state === 'ready',
            null,
            { timeout: 10000 }
          );
        } catch {
          failures.push(`${label}: оверлей успеха не закрылся по тапу, нет возврата в ready`);
        }
        if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
        }
      }
    } finally {
      await ctx.close();
    }
  });

  // P2-N4: прерванный скролл не покупает. Drag 12px с кнопки с отпуском
  // над ней же — покупки нет; обычный тап по той же кнопке — покупка.
  await runCase('tap-threshold drag-12px no-buy 390x844', async () => {
    const label = 'tap-threshold drag-12px no-buy 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      const g = await extractGeometry(page);
      const card = g.cards.find((c) => c.buyButton);
      if (!card?.buyButton) {
        failures.push(`${label}: кнопка покупки не найдена`);
        return;
      }
      const c = center(card.buyButton);
      // Отпуск — всё ещё над кнопкой (44px высота, 12px от центра).
      if (c.y + 12 >= card.buyButton.y + card.buyButton.h) {
        failures.push(`${label}: зонд невалиден — отпуск вне кнопки`);
        return;
      }
      await touchDrag(ctx, page, c, { x: c.x, y: c.y + 12 });
      await sleep(600);
      const st = await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        return { state: s.state, lastBought: s.lastBought?.id ?? null };
      });
      if (st.state !== 'ready' || st.lastBought) {
        failures.push(
          `${label}: drag 12px с кнопки начал покупку (state=${st.state}, lastBought=${st.lastBought})`
        );
        return;
      }
      // Контроль: обычный тап по той же кнопке — покупка идёт.
      await touchAt(ctx, page, c);
      try {
        await page.waitForFunction(
          () => window.__game.scene.getScene('Storefront').state === 'success',
          null,
          { timeout: 10000 }
        );
      } catch {
        failures.push(`${label}: тап по кнопке после порога не начал покупку`);
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // P2-N4: drag 70px по фону карточки — скролл (порог тапа его не ломает).
  await runCase('tap-threshold drag-70px scrolls 390x844', async () => {
    const label = 'tap-threshold drag-70px scrolls 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      const g = await extractGeometry(page);
      const card = g.cards.find((c) => c.buyButton && c.bg);
      if (!card?.bg) {
        failures.push(`${label}: карточка не найдена`);
        return;
      }
      // Старт — на фоне карточки слева (не на кнопке справа).
      const from = { x: Math.round(card.bg.x + 30), y: Math.round(card.bg.y + card.bg.h / 2) };
      const before = await page.evaluate(() => window.__game.scene.getScene('Storefront').scrollOffset);
      await touchDrag(ctx, page, from, { x: from.x, y: from.y - 70 });
      await sleep(300);
      const after = await page.evaluate(() => window.__game.scene.getScene('Storefront').scrollOffset);
      if (!(after > before + 20)) {
        failures.push(`${label}: drag 70px не проскроллил (offset ${before} -> ${after})`);
      }
      const st = await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        return { state: s.state, lastBought: s.lastBought?.id ?? null };
      });
      if (st.state !== 'ready' || st.lastBought) {
        failures.push(`${label}: drag по фону начал покупку (state=${st.state})`);
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // CR3: покупка пропуска до известного состояния restore блокируется.
  // Чистая установка: restore завершается (restoreState known); пока
  // состояние неизвестно (симулируем renderContent при pending) — кнопка
  // '···' и тап не покупает; после known — покупка разрешена.
  await runCase('pass-restore-gating 390x844', async () => {
    const label = 'pass-restore-gating 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: false });
    try {
      try {
        await page.waitForFunction(
          () => window.__game.scene.getScene('Storefront').restoreState === 'known',
          null,
          { timeout: 15000 }
        );
      } catch {
        failures.push(`${label}: restore не завершился (restoreState не стал known)`);
        return;
      }
      await scrollPassIntoView(page);
      // Симулируем «restore ещё не завершён»: pending + перерендер.
      await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        s.restoreState = 'pending';
        s.renderContent();
      });
      await sleep(200);
      await scrollPassIntoView(page);
      const pending = await passButtonState(page);
      if (pending.label !== '···') {
        failures.push(`${label}: при неизвестном restore кнопка пропуска — '${pending.label}' вместо '···'`);
      }
      const g = await extractGeometry(page);
      const pass = g.cards.find((c) => c.id === 'season-pass.basic-30d');
      if (!pass?.buyButton) {
        failures.push(`${label}: кнопка покупки пропуска не найдена`);
        return;
      }
      await touchAt(ctx, page, center(pass.buyButton));
      await sleep(600);
      const st = await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        return { state: s.state, lastBought: s.lastBought?.id ?? null };
      });
      if (st.state !== 'ready' || st.lastBought) {
        failures.push(
          `${label}: тап по кнопке пропуска при pending-restore начал покупку (state=${st.state}, lastBought=${st.lastBought})`
        );
        return;
      }
      // Restore известен — покупка разрешена.
      await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        s.restoreState = 'known';
        s.renderContent();
      });
      await sleep(200);
      await scrollPassIntoView(page);
      const known = await passButtonState(page);
      if (known.label === '···' || known.label === 'АКТИВЕН') {
        failures.push(`${label}: после known кнопка пропуска — '${known.label}' (покупка не разблокирована)`);
        return;
      }
      const g2 = await extractGeometry(page);
      const pass2 = g2.cards.find((c) => c.id === 'season-pass.basic-30d');
      await touchAt(ctx, page, center(pass2.buyButton));
      try {
        await page.waitForFunction(
          () => window.__game.scene.getScene('Storefront').state === 'success',
          null,
          { timeout: 10000 }
        );
      } catch {
        failures.push(`${label}: после known тап по кнопке пропуска не начал покупку`);
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  // CR3: после restore с активным пропуском — «АКТИВЕН», тап не покупает.
  await runCase('pass-restore-gating active 390x844', async () => {
    const label = 'pass-restore-gating active 390x844';
    const { ctx, page, errors } = await bootStorefront(browser, { width: 390, height: 844 }, { passActive: true });
    try {
      try {
        await page.waitForFunction(
          () => window.__game.scene.getScene('Storefront').restoreState === 'known',
          null,
          { timeout: 15000 }
        );
      } catch {
        failures.push(`${label}: restore не завершился (restoreState не стал known)`);
        return;
      }
      await scrollPassIntoView(page);
      const st0 = await passButtonState(page);
      if (st0.label !== 'АКТИВЕН') {
        failures.push(`${label}: при активном пропуске кнопка — '${st0.label}' вместо 'АКТИВЕН'`);
        return;
      }
      const g = await extractGeometry(page);
      const pass = g.cards.find((c) => c.id === 'season-pass.basic-30d');
      await touchAt(ctx, page, center(pass.buyButton));
      await sleep(600);
      const st = await page.evaluate(() => {
        const s = window.__game.scene.getScene('Storefront');
        return { state: s.state, lastBought: s.lastBought?.id ?? null };
      });
      if (st.state !== 'ready' || st.lastBought) {
        failures.push(`${label}: тап по 'АКТИВЕН' начал покупку (state=${st.state})`);
      }
      if (errors.length) failures.push(`${label}: page errors: ${errors.join(' | ')}`);
    } finally {
      await ctx.close();
    }
  });

  await browser.close();
  console.log(`storefront layout smoke: ${cases} cases, ${failures.length} failure(s)`);
  // P3-N3: сводка по кейсам — видно, какие кейсы упали, а какие прошли.
  for (const r of caseResults) {
    console.log(`  ${r.failures ? 'FAIL' : 'ok  '} ${r.label} (${r.failures} failure(s))`);
  }
  if (failures.length) {
    for (const f of failures) console.error('  FAIL ' + f);
    process.exit(1);
  }
  console.log('storefront layout smoke: ok');
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
