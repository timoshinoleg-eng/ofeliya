/**
 * Проверка идентичности пропуска: копия пропускает ТОЛЬКО своё появление исходного врага.
 *
 * Обязательные случаи:
 *   1) копия НЕ наносит урон своему исходному появлению, и это НЕ следствие того,
 *      что цель уже мертва: цель остаётся живой, счётчик пропуска растёт, HP цели
 *      сохраняется, а копия остаётся активной (не израсходована);
 *   2) копия НАНОСИТ урон ДРУГОМУ врагу с ТЕМ ЖЕ серийным номером
 *      (счётчик spawnSerial инстансный — у двух разных врагов при первом появлении он 1);
 *   3) копия МОЖЕТ поразить исходный ОБЪЕКТ после его переиспользования
 *      (объект вернулся в пул и вышел уже под новым появлением — новым номером).
 *
 * На каждый случай берётся СВОЯ свежая копия: копия с пробитием 0 израсходуется первым же
 * попаданием по любой цели.
 *
 * Запуск:
 *   NODE_PATH=/workspace/ofeliya/node_modules \
 *   OFELIYA_BASE_URL=http://127.0.0.1:5185/ \
 *   node probe/verify-skip-identity.cjs
 */
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.OFELIYA_BASE_URL || 'http://127.0.0.1:5185/';
const OUT = path.join(require('os').tmpdir(), 'ofeliya-verify-skip-new.json');

function browserDriver() {
  const { chromium } = require('playwright');
  const candidates = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* not registered */
  }
  for (const root of [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(process.env.HOME || '', '.cache/ms-playwright'),
    '/root/.cache/ms-playwright',
    '/workspace/.home/.cache/ms-playwright',
  ]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      candidates.push(
        path.join(root, dir, 'chrome-linux64', 'chrome'),
        path.join(root, dir, 'chrome-linux', 'chrome')
      );
    }
  }
  candidates.unshift('C:/Program Files/Google/Chrome/Application/chrome.exe');
  const executablePath = candidates.find((c) => c && fs.existsSync(c));
  if (!executablePath) throw new Error('Chromium not found');
  return { chromium, executablePath };
}

(async () => {
  const { chromium, executablePath } = browserDriver();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('https://st.max.ru/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
  );
  await ctx.addInitScript(() => {
    localStorage.setItem('ofeliya_save_v1', JSON.stringify({ muted: true, runs: 1 }));
    window.WebApp = {
      platform: 'android',
      version: '26.20.0',
      initData: 'signed-verify',
      initDataUnsafe: { user: { id: 1, first_name: 'V', last_name: 'QA' } },
      getViewportSize: async () => ({ width: 390, height: 844 }),
      BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
      HapticFeedback: { impactOccurred() {}, notificationOccurred() {} },
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.scene.isActive('Menu'));
  await page.evaluate(() => window.__game.scene.getScene('Menu').scene.start('Game'));
  await page.waitForFunction(
    () => (window.__game.scene.isActive('Game') || window.__game.scene.isPaused('Game')) && window.__game.scene.isActive('UI')
  );
  await page.evaluate(() => { const game=window.__game; const ui=game.scene.getScene('UI'); ui.dismissProgressionForStageBoundary(); const gs=game.scene.getScene('Game'); gs.awaitingChoice=false; gs.pendingChoices=[]; gs.queuedLevels=0; if(game.scene.isPaused('Game')) game.scene.resume('Game'); });

  const result = await page.evaluate(() => {
    const game = window.__game;
    const gs = game.scene.getScene('Game');
    game.__probeClock = game.loop.now;
    game.loop.stop();
    game.renderer.preRender = () => {};
    game.renderer.postRender = () => {};
    game.scene.render = () => {};
    const step = (n) => {
      for (let i = 0; i < n; i++) {
        game.__probeClock += 1000 / 60;
        game.step(game.__probeClock, 1000 / 60);
      }
    };

    const out = { cases: {}, notes: [] };

    gs.runState.run.legendaryIds.clear();
    gs.runState.run.legendaryIds.add('split-geometry');
    gs.setQaNoCopyKnockback?.(true);
    gs.setQaSingleGeneration?.(true);
    gs.setQaSkipSource?.(true);
    gs.nextFireAt = Number.MAX_SAFE_INTEGER;

    const px = gs.player.x;
    const py = gs.player.y;

    // ── Враг A (первое появление объекта) и враг B (другой объект, тот же номер) ──
    const A = gs.spawnEnemy('swarm', px + 220, py, false);
    const B = gs.spawnEnemy('swarm', px + 320, py, false);
    while (B.spawnSerial < A.spawnSerial) { B.deactivateForStageReset(); B.activate(gs, 'swarm', px + 320, py, { elite: false, hpScale: 1, dmgScale: 1, speedScale: 1 }); }
    const sameSerialAtCollision = A.spawnSerial === B.spawnSerial;
    // Исходная цель должна ОСТАТЬСЯ ЖИВОЙ: иначе «нулевой урон от копии» проходит
    // и при неработающем пропуске (цель и так уже мертва).
    A.hp = 1_000_000;
    A.maxHp = 1_000_000;
    out.notes.push(
      `A: serial=${A.spawnSerial}; B: serial=${B.spawnSerial}; A===B: ${A === B}; A.hp поднят до 1e6 ДО выстрела`
    );

    // Выстрел оригинала в A → рождаются копии.
    const shootAt = (target) => {
      // Только НОВЫЕ копии: в пуле остаются снаряды от авто-огня игрока
      // (урон 10 ⇒ их копии бьют по 4,5), иначе можно померить чужую пулю.
      const before = new Set(gs.bullets.getChildren());
      const bullet = gs.bullets.get(px, py);
      bullet.fire(gs.time.now, 0, 100, 0, false, 0);
      bullet.setPosition(target.x, target.y);
      step(4);
      return gs.bullets
        .getChildren()
        .filter((b) => b.active && b.generation > 0 && !before.has(b));
    };
    let copies = shootAt(A);
    out.notes.push(
      `копий после выстрела: ${copies.length}; источник записан: ${copies[0]?.qaSourceEnemy === A}, serial=${copies[0]?.qaSourceSpawnSerial}`
    );

    // ── Случай 1: копия не ранит своё исходное появление (цель жива!) ───────
    const copy1 = copies[0];
    const hpBeforeCopyAttempt = A.hp;
    const skipBefore = gs.qaSkippedCopyCollisions ?? 0;
    let damageToSource = 0;
    let hpAfterSourceAttempt = null;
    let copyStillActive = false;
    let skipGrew = false;
    if (copy1) {
      copy1.setPosition(A.x, A.y);
      copy1.body.reset(A.x, A.y);
      step(3);
      hpAfterSourceAttempt = A.hp;
      damageToSource = hpBeforeCopyAttempt - A.hp;
      copyStillActive = copy1.active;
      skipGrew = (gs.qaSkippedCopyCollisions ?? 0) > skipBefore;
    }

    // ── Случай 2: копия ранит ДРУГОГО врага с тем же номером ───────────────
    // Берём копию ИЗ СВОЕГО выстрела: в пуле остаются снаряды от авто-огня
    // игрока (урон 10 ⇒ их копии бьют по 4,5), иначе можно померить чужую пулю.
    const copy2 = copies[1] ?? copies[0];
    let damageToSameSerial = 0;
    let hpBBefore = null;
    let hpBAfter = null;
    if (copy2 && B) {
      hpBBefore = B.hp;
      copy2.setPosition(B.x, B.y);
      copy2.body.reset(B.x, B.y);
      step(3);
      hpBAfter = B.hp;
      damageToSameSerial = hpBBefore - B.hp;
    }

    // ── Случай 3: исходный ОБЪЕКТ после переиспользования ─────────────────
    // Тот же объект выходит в пул и снова появляется — но уже как НОВОЕ появление (номер +1).
    const serialBefore = A.spawnSerial;
    A.deactivateForStageReset();
    A.activate(gs, 'swarm', px + 420, py, {
      elite: false,
      hpScale: 1,
      dmgScale: 1,
      speedScale: 1,
    });
    // Третью копию получаем отдельным своим выстрелом — из своего, не из пула.
    A.hp = 1_000_000;
    A.maxHp = 1_000_000;
    // Копия из ПЕРВОГО выстрела: её источник — появление №1. Новая стрельба здесь
    // не нужна и была бы вредна (она убила бы цель и создала копии с источником №2).
    const copy3 = copies[0];
    let damageAfterReuse = 0;
    if (copy3) {
      const hpCBefore = A.hp;
      copy3.setPosition(A.x, A.y);
      copy3.body.reset(A.x, A.y);
      step(3);
      damageAfterReuse = hpCBefore - A.hp;
    }
    out.notes.push(
      `переиспользование: тот же объект, номер появления ${serialBefore} -> ${A.spawnSerial}`
    );

    out.cases = {
      '1_копия_не_ранит_своё_исходное_появление': {
        hpBeforeCopyAttempt,
        hpAfterSourceAttempt,
        damageByCopyOnSource: damageToSource,
        sourceStillAlive: (hpAfterSourceAttempt ?? 0) > 0,
        skipCounterGrew: skipGrew,
        copyStillActive,
        ok:
          damageToSource === 0 &&
          (hpAfterSourceAttempt ?? 0) > 0 &&
          skipGrew &&
          copyStillActive,
      },
      '2_копия_ранит_другого_врага_с_тем_же_номером': {
        enemySerial: B?.spawnSerial ?? null,
        sameObject: A === B,
        sameSerialAtCollision,
        hpBefore: hpBBefore,
        hpAfter: hpBAfter,
        damageByCopy: damageToSameSerial,
        ok: A !== B && sameSerialAtCollision && damageToSameSerial > 0,
      },
      '3_копия_ранит_исходный_объект_после_переиспользования': {
        oldSerial: serialBefore,
        newSerial: A.spawnSerial,
        copyDamage: copy3 ? copy3.damage : null,
        damageByCopy: damageAfterReuse,
        ok: A.spawnSerial > serialBefore && damageAfterReuse > 0,
      },
    };
    out.skippedCollisions = gs.qaSkippedCopyCollisions ?? 0;
    return out;
  });

  if (errors.length) throw new Error(`page errors: ${errors.join(' | ')}`);

  const cases = result.cases;
  const allOk = Object.values(cases).every((c) => c.ok);
  console.log('\n=== ПРОВЕРКА ИДЕНТИЧНОСТИ ПРОПУСКА ===');
  for (const note of result.notes) console.log('  · ' + note);
  console.log('');
  for (const [name, c] of Object.entries(cases)) {
    console.log(`  ${c.ok ? 'OK  ' : 'FAIL'} ${name}`);
    console.log(`       ${JSON.stringify(c)}`);
  }
  console.log(`\n  пропущенных столкновений: ${result.skippedCollisions}`);
  console.log(`  ИТОГ: ${allOk ? 'ВСЕ ТРИ СЛУЧАЯ ПОДТВЕРЖДЕНЫ' : 'ЕСТЬ ПРОВАЛ'}`);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...result, allOk }, null, 2));
  console.log(`→ ${OUT}`);

  await browser.close();
  if (!allOk) process.exit(1);
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
