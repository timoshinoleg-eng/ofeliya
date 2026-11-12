/**
 * QA-режим для телефона: «КАРДИАЛЬНЫЙ ТИТАН» — короткая пара БЕЗ КАРТЫ / КАНДИДАТ.
 *
 * Кандидат этой итерации: копии не отбрасывают цель, не делятся повторно
 * (одно поколение) и ПРОПУСКАЮТ врага, попадание в которого их породило.
 *
 * Включается ТОЛЬКО по URL-параметру `?qa=titan-candidate` и ТОЛЬКО в QA-сборке
 * (VITE_QA_TOOLS=1). В обычной игре модуль не подключается и ничего не меняет.
 *
 * Два эпизода, одинаковый старт:
 *   1) без карты;
 *   2) с картой-кандидатом: копии не отбрасывают цель и не делятся повторно.
 *
 * Одинаковый старт обеспечивается ОДНИМ И ТЕМ ЖЕ сидом: забег перезапускается
 * целиком, поэтому RNG, стадия, трофей и стартовый босс совпадают.
 *
 * Итог каждого эпизода сохраняется в localStorage и переживает смерть игрока.
 */
import type Phaser from 'phaser';

const QA_PARAM = 'titan-candidate';
const STORE_KEY = 'ofeliya_qa_titan_candidate_v1';
const EPISODE_TIMEOUT_MS = 120_000;
const EPISODE_WALL_TIMEOUT_MS = 240_000;

export type QaScenario = 'titan' | 'crowd';

export interface TitanEpisodeResult {
  episode: number;
  arm: 'no-card' | 'candidate';
  scenario: QaScenario;
  seed: string;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  survivedMs: number;
  outcome: 'win' | 'player-death' | 'timeout';
  hpLeft: number;
  bossHpLeft: number | null;
  bossMaxHp: number | null;
  bossPhase: number | null;
  /** Сколько врагов осталось в живых на конец эпизода. */
  enemiesAlive: number;
  /** Момент, когда поле было зачищено (для толпы); null — если не зачищено. */
  clearedAtMs: number | null;
}

interface Overlay {
  root: HTMLDivElement;
  body: HTMLDivElement;
  show(html: string): void;
}

function makeOverlay(): Overlay {
  const root = document.createElement('div');
  root.dataset.qaOverlay = 'titan-candidate';
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#0d0710f2', 'color:#f6efe6',
    'font:600 16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
    'padding:18px', 'overflow:auto', 'display:flex', 'flex-direction:column', 'gap:14px',
  ].join(';');
  const body = document.createElement('div');
  root.appendChild(body);
  document.body.appendChild(root);
  return {
    root,
    body,
    show(html: string) {
      body.innerHTML = html;
    },
  };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = [
    'display:block', 'width:100%', 'padding:16px', 'margin-top:10px',
    'font:700 17px/1 system-ui', 'border-radius:12px', 'border:0',
    'background:#ff6b4a', 'color:#140a06', 'cursor:pointer',
  ].join(';');
  b.addEventListener('click', onClick);
  return b;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function sceneOf(game: Phaser.Game): any {
  return game.scene.getScene('Game');
}

const FIXED_DT = 1000 / 60;

/**
 * Режим FAST: останавливает RAF-цикл и двигает время фиксированным шагом.
 *
 * Нужен ТОЛЬКО для проверки на компьютере: headless-Chromium рисует программно
 * и даёт ~1 кадр в секунду. На телефоне этот режим НЕ включается.
 */
function installFastClock(game: Phaser.Game): void {
  const g = game as any;
  if (g.__qaFastClock) return;
  g.__qaFastClock = true;
  g.__qaClock = g.loop.now;
  g.loop.stop();
  g.renderer.preRender = () => {};
  g.renderer.postRender = () => {};
  g.scene.render = () => {};
  const drive = () => {
    for (let i = 0; i < 8; i++) {
      g.__qaClock += FIXED_DT;
      g.step(g.__qaClock, FIXED_DT);
    }
  };
  (globalThis as any).__qaFastTimer = setInterval(drive, 16);
}

/** Фикстура боя: изолирует XP-прогрессию, бой остаётся настоящим. */
function installCombatFixture(game: Phaser.Game): void {
  const gs = sceneOf(game);
  if (!gs.__qaOrigCreate) gs.__qaOrigCreate = gs.create;
  const originalCreate = gs.__qaOrigCreate;
  gs.create = function (...args: unknown[]) {
    this.create = originalCreate;
    originalCreate.apply(this, args);
    // Метка собранного забега: без неё второй эпизод стартует, пока сцена
    // ещё не пересоздана (старая сцена после победы остаётся активной).
    this.__qaCreatedToken = this.__qaRunToken ?? 0;
    this.runState.stage.xp = 0;
    this.runState.stage.xpNext = 1_000_000;
    this.queuedLevels = 0;
    const reset = this.runState.resetStageProgression;
    this.runState.resetStageProgression = function (...args: unknown[]) {
      const result = reset.apply(this, args);
      this.stage.xp = 0;
      this.stage.xpNext = 1_000_000;
      return result;
    };
  };
}

/** Спавн: только управляемое поле, естественный спавнер выключен. */
function installSpawnGate(game: Phaser.Game): void {
  const gs = sceneOf(game) as any;
  if (!gs.__qaOrigSpawn) gs.__qaOrigSpawn = gs.spawnEnemy.bind(gs);
  if (!gs.__qaOrigDamaged) gs.__qaOrigDamaged = gs.onEnemyDamaged.bind(gs);
  if (!gs.__qaOrigRecord) gs.__qaOrigRecord = gs.wave.recordPlayerDamage.bind(gs.wave);
  (globalThis as any).__qaAllowSpawn = false;
  gs.spawnEnemy = (kind: string, x: number, y: number, elite: boolean) => {
    const gate = globalThis as any;
    if (kind === 'boss') return gs.__qaOrigSpawn(kind, x, y, elite);
    if (!gate.__qaAllowSpawn) return null;
    gate.__qaAllowSpawn = false;
    return gs.__qaOrigSpawn(kind, x, y, elite);
  };
}

async function waitUntil(
  game: Phaser.Game,
  predicate: () => boolean,
  timeoutMs = 30_000,
  label = 'condition'
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch {
      /* сцена ещё не готова */
    }
    await sleep(50);
  }
  throw new Error(`QA titan-candidate: timeout waiting for ${label}`);
}

async function jumpToHeart(game: Phaser.Game): Promise<void> {
  const gs = sceneOf(game);
  gs.runState.stage.hp = 1_000_000;
  gs.runState.stage.maxHp = 1_000_000;
  gs.runState.stage.timeMs = gs.stageDirector.currentStage.durationMs;
  gs.handleStageEvents(gs.stageDirector.update(gs.runState.stage.timeMs));
  await waitUntil(game, () => Boolean(sceneOf(game).wave.boss), 15_000, 'boss');
  sceneOf(game).wave.boss.takeDamage(Number.MAX_SAFE_INTEGER);
  // Переход может завершиться сам (таймер на сцене) до того, как мы дёрнем коммит,
  // а видео-вставка появления босса ставит сцену на паузу на РЕАЛЬНОЕ время — поэтому
  // ждём ЛИБО готовую транзакцию, ЛИБО уже начавшееся «Сердце».
  await waitUntil(
    game,
    () => {
      const s = sceneOf(game);
      return (
        s.stageDirector.currentStage.id === 'heart' ||
        (s.stageTransition !== null && s.stageDirector.phase === 'STAGE_TRANSITION')
      );
    },
    60_000,
    'transition ready'
  );
  await sleep(600);
  const gs2 = sceneOf(game);
  if (gs2.stageTransition) gs2.requestStageTransitionCommit(gs2.stageTransition.token);
  await waitUntil(
    game,
    () => {
      const s = sceneOf(game);
      return s.stageDirector.currentStage.id === 'heart' && s.stageDirector.phase === 'PLAYING';
    },
    30_000,
    'heart stage'
  );
  await waitUntil(
    game,
    () => {
      const s = sceneOf(game);
      return s.legendaryRewardPending === true && s.awaitingChoice === true;
    },
    20_000,
    'trophy'
  );
}

async function runEpisode(
  game: Phaser.Game,
  seed: string,
  arm: 'no-card' | 'candidate',
  episode: number,
  onLive: (text: string) => void,
  fast = false,
  scenario: QaScenario = 'titan'
): Promise<TitanEpisodeResult> {
  if (fast) installFastClock(game);
  game.registry.set('runSeedOverride', seed);
  installCombatFixture(game);
  // Токен забега: ждём, пока сцена действительно пересобрана, а не просто активна.
  const gs0 = sceneOf(game);
  gs0.__qaRunToken = (gs0.__qaRunToken ?? 0) + 1;
  const wantedToken = gs0.__qaRunToken;
  game.scene.getScene('Menu').scene.start('Game');
  await waitUntil(
    game,
    () => {
      const s = sceneOf(game);
      return (
        game.scene.isActive('Game') &&
        game.scene.isActive('UI') &&
        s.__qaCreatedToken === wantedToken
      );
    },
    30_000,
    'game scene rebuilt'
  );
  installSpawnGate(game);

  await jumpToHeart(game);

  const gs = sceneOf(game);
  const ui = game.scene.getScene('UI') as any;
  const first = gs.pendingChoices[0];
  if (!first) throw new Error('QA titan-candidate: трофей пуст');
  gs.chooseUpgrade(first.id);
  ui.hideModal();
  gs.scene.resume();
  await waitUntil(game, () => sceneOf(game).scene.isPaused() === false, 5_000, 'scene resume');

  // ── Различие между эпизодами — только это ──────────────────────────────
  gs.runState.run.legendaryIds.clear();
  if (arm === 'candidate') gs.runState.run.legendaryIds.add('split-geometry');
  const candidate = arm === 'candidate';
  if (typeof gs.setQaNoCopyKnockback === 'function') gs.setQaNoCopyKnockback(candidate);
  if (typeof gs.setQaSingleGeneration === 'function') gs.setQaSingleGeneration(candidate);
  if (typeof gs.setQaSkipSource === 'function') gs.setQaSkipSource(candidate);

  // Билд «Сердца»: как в боевом пробнике (развитый снарядный билд).
  gs.runState.stage.damageMul = Math.pow(1.25, 4);
  gs.runState.stage.projectiles = 3;
  gs.runState.stage.pierce = 2;
  gs.runState.stage.fireRateMul = Math.pow(1.15, 3);
  gs.runState.stage.speedMul = 1.08;
  gs.runState.stage.maxHp = 100;
  gs.runState.stage.hp = 100;

  // Один Титан на старте.
  for (const e of gs.enemies.getChildren()) {
    if (e.active) e.deactivateForStageReset();
  }
  (globalThis as any).__qaAllowSpawn = true;
  const px = gs.player.x;
  const py = gs.player.y;
  if (scenario === 'titan') {
    const boss = gs.__qaOrigSpawn('boss', px + 150, py - 120, false);
    gs.wave.boss = boss;
  } else {
    // Плотная волна: 90 врагов тремя кольцами (как в сценарии B боевого прогона).
    const ring = (count: number, radius: number, kind: string, phase: number) => {
      for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * Math.PI * 2;
        (globalThis as any).__qaAllowSpawn = true;
        gs.__qaOrigSpawn(kind, px + Math.cos(a) * radius, py + Math.sin(a) * radius, false);
      }
    };
    ring(36, 180, 'swarm', 0);
    ring(27, 240, 'runner', 0.11);
    ring(27, 300, 'brute', 0.23);
  }

  // Счётчики боя.
  let clearedAtMs: number | null = null;
  let damageDealt = 0;
  let damageTaken = 0;
  const origDamaged = gs.__qaOrigDamaged;
  gs.onEnemyDamaged = function (enemy: unknown, damage: number) {
    damageDealt += damage;
    return origDamaged.call(this, enemy, damage);
  };
  const origRecord = gs.__qaOrigRecord;
  gs.wave.recordPlayerDamage = (damage: number, maxHp: number) => {
    damageTaken += damage;
    return origRecord(damage, maxHp);
  };

  // Исход боя — по событиям: гибель босса и смерть игрока.
  let outcome: TitanEpisodeResult['outcome'] = 'timeout';
  const origDied = gs.onEnemyDied;
  gs.onEnemyDied = function (e: unknown) {
    const en = e as { isBoss?: boolean };
    if (en && en.isBoss && outcome === 'timeout') outcome = 'win';
    return origDied.call(this, e);
  };
  const origFinish = gs.finish;
  gs.finish = function (win: boolean, reason: string) {
    if (!win && outcome === 'timeout') outcome = 'player-death';
    return origFinish.call(this, win, reason);
  };

  // Игрок управляемо сближается с боссом (как в сценарии C3 боевого прогона).
  const startTime = gs.runState.stage.timeMs;
  const wallStart = Date.now();
  let lastPaint = 0;
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const s = sceneOf(game);
      if (!s || !s.runState) {
        clearInterval(timer);
        resolve();
        return;
      }
      const b = s.wave.boss;
      if (b && b.active) {
        const dx = b.x - s.player.x;
        const dy = b.y - s.player.y;
        const d = Math.hypot(dx, dy);
        const dir = d > 240 ? 1 : d < 200 ? -1 : 0;
        s.registry.set('joy', d > 1 ? { x: (dx / d) * dir, y: (dy / d) * dir } : { x: 0, y: 0 });
      }
      const now = s.runState.stage.timeMs;
      if (now - lastPaint > 250) {
        lastPaint = now;
        onLive(
          `Убито: ${s.runState.stage.kills} · Урон нанесён: ${Math.round(damageDealt)} · ` +
            `Потери: ${Math.round(damageTaken)} · Прочность: ${Math.max(0, Math.round(s.runState.stage.hp))}` +
            (b ? ` · Титан: ${Math.round(b.hp)}/${Math.round(b.maxHp)}` : '')
        );
      }
      if (outcome !== 'timeout') {
        clearInterval(timer);
        resolve();
        return;
      }
      if (clearedAtMs === null && s.enemies.countActive(true) === 0 && s.runState.stage.kills > 0) {
        clearedAtMs = s.runState.stage.timeMs;
      }
      if (now - startTime > EPISODE_TIMEOUT_MS || Date.now() - wallStart > EPISODE_WALL_TIMEOUT_MS) {
        clearInterval(timer);
        resolve();
      }
    }, 120);
  });

  const gsEnd = sceneOf(game);
  const bossEnd = gsEnd.wave?.boss;
  return {
    episode,
    arm,
    scenario,
    seed,
    kills: gsEnd.runState.stage.kills,
    damageDealt: Math.round(damageDealt),
    damageTaken: Math.round(damageTaken),
    survivedMs: Math.round(gsEnd.runState.stage.timeMs - startTime),
    outcome,
    hpLeft: Math.max(0, Math.round(gsEnd.runState.stage.hp)),
    bossHpLeft: bossEnd ? Math.round(bossEnd.hp) : null,
    bossMaxHp: bossEnd ? Math.round(bossEnd.maxHp) : null,
    bossPhase: bossEnd ? (bossEnd.bossPhase ?? null) : null,
    enemiesAlive: gsEnd.enemies.countActive(true),
    clearedAtMs,
  };
}

function renderResult(r: TitanEpisodeResult): string {
  const arm = r.arm === 'candidate'
    ? 'КАНДИДАТ (копии не отбрасывают, одно поколение, пропуск исходного появления)'
    : 'БЕЗ КАРТЫ';
  const what = r.scenario === 'titan' ? 'КАРДИАЛЬНЫЙ ТИТАН' : 'ПЛОТНАЯ ВОЛНА 90 ВРАГОВ';
  const out =
    r.outcome === 'win' ? 'титан убит' : r.outcome === 'player-death' ? 'смерть игрока' : 'таймаут';
  return [
    `<div style="font-size:22px;font-weight:800;margin-bottom:6px">Эпизод ${r.episode}: ${what} — ${arm}</div>`,
    `<div>Исход: <b>${out}</b></div>`,
    `<div>Убито врагов: <b>${r.kills}</b></div>`,
    `<div>Урон нанесён: <b>${r.damageDealt}</b></div>`,
    `<div>Получено урона: <b>${r.damageTaken}</b></div>`,
    `<div>Продержался: <b>${(r.survivedMs / 1000).toFixed(1)} с</b></div>`,
    `<div>Прочность: <b>${r.hpLeft}</b></div>`,
    `<div>Титан: HP <b>${r.bossHpLeft ?? '—'}</b> / ${r.bossMaxHp ?? '—'}, фаза <b>${r.bossPhase ?? '—'}</b></div>`,
    `<div>Живых врагов осталось: <b>${r.enemiesAlive}</b>${
      r.clearedAtMs != null ? ` · поле зачищено на ${(r.clearedAtMs / 1000).toFixed(1)} с` : ''
    }</div>`,
  ].join('');
}

export function startTitanCandidateQA(game: Phaser.Game): void {
  const params = new URLSearchParams(location.search);
  if (params.get('qa') !== QA_PARAM) return;
  const seed = params.get('seed') || 'titan-candidate-1';
  const fast = params.get('fast') === '1';
  const overlay = makeOverlay();
  const results: TitanEpisodeResult[] = [];

  // Четыре эпизода: одиночный Титан (без карты / кандидат) и плотная волна при
  // штатных 100 HP (без карты / кандидат). Одинаковый сид и одинаковый старт в паре.
  const PLAN: { arm: 'no-card' | 'candidate'; scenario: QaScenario }[] = [
    { arm: 'no-card', scenario: 'titan' },
    { arm: 'candidate', scenario: 'titan' },
    { arm: 'no-card', scenario: 'crowd' },
    { arm: 'candidate', scenario: 'crowd' },
  ];

  const persist = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(results.filter(Boolean)));
    } catch {
      /* приватный режим */
    }
  };

  const runFrom = (i: number) => {
    if (i >= PLAN.length) {
      const json = JSON.stringify(results.filter(Boolean), null, 2);
      overlay.show(
        [
          ...results.filter(Boolean).map((r) => renderResult(r)),
          '<hr style="border:0;border-top:1px solid #ffffff22;margin:8px 0">',
          `<div style="opacity:.85">Итог сохранён в localStorage: <code>${STORE_KEY}</code></div>`,
        ].join('')
      );
      const copy = button('Скопировать JSON результата', () => {
        void navigator.clipboard?.writeText(json).then(
          () => {
            copy.textContent = 'Скопировано ✓';
          },
          () => {
            copy.textContent = 'Не удалось скопировать';
          }
        );
      });
      overlay.body.appendChild(copy);
      return;
    }
    const arm = PLAN[i].arm;
    const what = PLAN[i].scenario === 'titan' ? 'КАРДИАЛЬНЫЙ ТИТАН' : 'ПЛОТНАЯ ВОЛНА 90 ВРАГОВ';
    const title = `Эпизод ${i + 1}: ${what} — ${arm === 'candidate' ? 'КАНДИДАТ' : 'БЕЗ КАРТЫ'}`;
    overlay.show(`<div>${title}: загрузка…</div>`);
    void (async () => {
      try {
        const r = await runEpisode(
          game,
          seed,
          arm,
          i + 1,
          (t) =>
            overlay.show(`<div style="font-size:20px;font-weight:800">${title}</div><div>${t}</div>`),
          fast,
          PLAN[i].scenario
        );
        results[i] = r;
        persist();
        overlay.show(renderResult(r));
        overlay.body.appendChild(
          button(
            i + 1 < PLAN.length
              ? `Перейти: эпизод ${i + 2} — ${
                  PLAN[i + 1].scenario === 'titan' ? 'ТИТАН' : 'ТОЛПА'
                } ${PLAN[i + 1].arm === 'candidate' ? 'С КАРТОЙ' : 'БЕЗ КАРТЫ'}`
              : 'Показать все эпизоды',
            () => {
              runFrom(i + 1);
            }
          )
        );
      } catch (error) {
        overlay.show(`<div style="color:#ff8a7a">Эпизод ${i + 1} не завершён: ${String(error)}</div>`);
      }
    })();
  };

  overlay.show(
    [
      '<div style="font-size:24px;font-weight:800">QA: КАРДИАЛЬНЫЙ ТИТАН</div>',
      '<div>Четыре коротких боя с одинаковым стартом: <b>одиночный Титан</b> и <b>плотная волна ' +
        '90 врагов</b> — каждое в паре <b>без карты</b> / <b>кандидат</b> ' +
        '(копии не отбрасывают цель, не делятся повторно и пропускают исходное появление).</div>',
      '<div>Билд «Сердца» развитый. В бою с Титаном игрок управляемо сближается с боссом; ' +
        'в бою с толпой — стоит на месте. Эпизод закончится гибелью босса, смертью игрока ' +
        'или таймаутом.</div>',
      `<div style="opacity:.7">сид: ${seed}</div>`,
    ].join('')
  );
  overlay.body.appendChild(button('Начать эпизод 1 (Титан, без карты)', () => runFrom(0)));
}
