/**
 * QA-режим для телефона: перенос одного стака мутации в «Сердце» — два боевых
 * эпизода с ОДИНАКОВЫМ стартом.
 *
 * Включается ТОЛЬКО по URL-параметру `?qa=carry-pair` и ТОЛЬКО в QA-сборке
 * (VITE_QA_TOOLS=1). В обычной игре модуль не подключается и ничего не меняет.
 *
 * Что делает:
 *  1. Игрок видит инструкцию и жмёт «Начать».
 *  2. Эпизод 1 (КОНТРОЛЬ): настоящий переход «Кровоток → Сердце», трофей,
 *     штатный сброс (без переноса), поле из 28 врагов, затем «КАРДИАЛЬНЫЙ
 *     ТИТАН». Игрок играет сам.
 *  3. Эпизод 2 (КАНДИДАТ): ТОТ ЖЕ старт (тот же сид, тот же путь кода, то же
 *     поле), но игрок входит в «Сердце» с ОДНИМ перенесённым стаком мутации.
 *  4. В конце — таблица обоих эпизодов, кнопка копирования JSON и копия
 *     результата в localStorage. Итог сохраняется СРАЗУ и переживает смерть.
 *
 * Одинаковый старт обеспечивается ОДНИМ И ТЕМ ЖЕ сидом: забег перезапускается
 * целиком, поэтому RNG, стадия, трофей и стартовое поле совпадают побайтово.
 */
import type Phaser from 'phaser';

const QA_PARAM = 'carry-pair';
const STORE_KEY = 'ofeliya_qa_carry_pair_v1';
const CROWD = 28;
const CROWD_RADIUS = 240;
const WAVE_TIMEOUT_MS = 45_000;
const BOSS_TIMEOUT_MS = 90_000;
/** Страховка по реальному времени: эпизод не может висеть бесконечно. */
const EPISODE_WALL_TIMEOUT_MS = 240_000;

export interface EpisodeResult {
  episode: number;
  arm: 'control' | 'candidate';
  seed: string;
  mutationId: string | null;
  carriedStacks: number | null;
  kills: number;
  damageDealt: number;
  damageTaken: number;
  waveKills: number;
  waveDamageDealt: number;
  waveSurvivedMs: number | null;
  bossDamage: number;
  bossHpLeft: number | null;
  bossMaxHp: number | null;
  bossKillAtMs: number | null;
  survivedMs: number;
  endedBy: 'wave-timeout' | 'wave-cleared' | 'boss-dead' | 'boss-timeout' | 'death';
  hpLeft: number;
  level: number;
  projectiles: number;
  trophy: string[];
}

interface Overlay {
  root: HTMLDivElement;
  body: HTMLDivElement;
  show(html: string): void;
}

function makeOverlay(): Overlay {
  const root = document.createElement('div');
  root.dataset.qaOverlay = 'carry-pair';
  root.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:99999',
    'background:#0b0a14f2', 'color:#f2eee6',
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
    'display:block', 'width:100%;padding:16px;margin-top:10px',
    'font:700 17px/1 system-ui', 'border-radius:12px', 'border:0',
    'background:#ffb347', 'color:#1a1206', 'cursor:pointer',
  ].join(';');
  b.addEventListener('click', onClick);
  return b;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitUntil(
  game: Phaser.Game,
  predicate: () => boolean,
  timeoutMs: number,
  label: string
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
  throw new Error(`QA carry-pair: timeout waiting for ${label}`);
}

function sceneOf(game: Phaser.Game): any {
  return game.scene.getScene('Game');
}

const FIXED_DT = 1000 / 60;

/**
 * Режим FAST: останавливает RAF-цикл и двигает время фиксированным шагом.
 * Только для проверки на компьютере (headless рисует ~1 fps). На телефоне
 * этот режим НЕ включается — там обычный игровой цикл.
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

/** Фикстура боя: изолирует XP-прогрессию, чтобы билд эпизода был заданным. */
function installCombatFixture(game: Phaser.Game): void {
  const gs = sceneOf(game);
  if (!gs.__qaOrigCreate) gs.__qaOrigCreate = gs.create;
  const originalCreate = gs.__qaOrigCreate;
  gs.create = function (...args: unknown[]) {
    this.create = originalCreate;
    originalCreate.apply(this, args);
    this.__qaCarryCreatedToken = this.__qaCarryRunToken ?? 0;
    this.runState.stage.xp = 0;
    this.runState.stage.xpNext = 1_000_000;
    this.queuedLevels = 0;
  };
}

/** Ворота спавна: естественный спавнер блокируется, поле задаёт сценарий. */
function installSpawnGate(game: Phaser.Game): void {
  const gs = sceneOf(game) as any;
  if (!gs.__qaOrigSpawn) gs.__qaOrigSpawn = gs.spawnEnemy.bind(gs);
  if (!gs.__qaOrigDamaged) gs.__qaOrigDamaged = gs.onEnemyDamaged.bind(gs);
  if (!gs.__qaOrigRecord) gs.__qaOrigRecord = gs.wave.recordPlayerDamage.bind(gs.wave);
  (globalThis as any).__qaAllowSpawn = false;
  gs.spawnEnemy = (kind: string, x: number, y: number, elite: boolean) => {
    if (kind === 'boss') return gs.__qaOrigSpawn(kind, x, y, elite);
    if (!(globalThis as any).__qaAllowSpawn) return null;
    (globalThis as any).__qaAllowSpawn = false;
    return gs.__qaOrigSpawn(kind, x, y, elite);
  };
}

/**
 * Настоящий переход «Кровоток → Сердце» с трофеем.
 *
 * `sourceStacks` — снимок билда «Кровотока»: перенос читает именно его
 * (`captureStageBuild` сохраняет стадию ДО сборки трофея), и без стака целевой
 * мутации перенос не происходит — проверка «мутация действительно взята в
 * Кровотоке». На телефоне «Кровоток» целиком не отыгрывается (эпизод длится
 * минуты), поэтому билд подставляется из снимка того же сида.
 */
async function jumpToHeart(game: Phaser.Game, sourceStacks: Record<string, number>): Promise<void> {
  const gs = sceneOf(game);
  for (const [k, v] of Object.entries(sourceStacks)) gs.runState.stage.stacks[k] = v;
  gs.runState.stage.hp = 1_000_000;
  gs.runState.stage.maxHp = 1_000_000;
  gs.runState.stage.timeMs = gs.stageDirector.currentStage.durationMs;
  gs.handleStageEvents(gs.stageDirector.update(gs.runState.stage.timeMs));
  await waitUntil(game, () => Boolean(sceneOf(game).wave.boss), 15_000, 'boss');
  sceneOf(game).wave.boss.takeDamage(Number.MAX_SAFE_INTEGER);
  await waitUntil(
    game,
    () => sceneOf(game).stageDirector.phase === 'STAGE_TRANSITION',
    15_000,
    'transition'
  );
  // Переход может завершиться сам (таймер игры) или по запросу. Поэтому ждём
  // «Сердце», а если транзакция ещё жива — подтверждаем её.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const gsNow = sceneOf(game);
    if (gsNow.stageDirector.currentStage.id === 'heart' && gsNow.stageDirector.phase === 'PLAYING') break;
    if (gsNow.stageTransition) gsNow.requestStageTransitionCommit(gsNow.stageTransition.token);
    await sleep(50);
  }
  if (sceneOf(game).stageDirector.currentStage.id !== 'heart') {
    throw new Error('QA carry-pair: heart stage did not start');
  }
  await waitUntil(
    game,
    () => sceneOf(game).legendaryRewardPending === true && sceneOf(game).awaitingChoice === true,
    20_000,
    'trophy'
  );
}

function takeTrophy(game: Phaser.Game): string[] {
  const gs = sceneOf(game);
  const names = gs.pendingChoices.map((c: any) => c.legendaryId ?? c.shortName);
  gs.chooseUpgrade(gs.pendingChoices[0].id);
  const ui: any = game.scene.getScene('UI');
  ui.hideModal?.();
  gs.scene.resume();
  return names;
}

async function runEpisode(
  game: Phaser.Game,
  seed: string,
  arm: 'control' | 'candidate',
  episode: number,
  mutationId: string | null,
  onLive: (text: string) => void,
  fast = false
): Promise<EpisodeResult> {
  if (fast) installFastClock(game);
  game.registry.set('runSeedOverride', seed);
  installCombatFixture(game);
  const initialScene = sceneOf(game);
  initialScene.__qaCarryRunToken = (initialScene.__qaCarryRunToken ?? 0) + 1;
  const wantedToken = initialScene.__qaCarryRunToken;
  game.scene.getScene('Menu').scene.start('Game');
  await waitUntil(
    game,
    () => game.scene.isActive('Game') && game.scene.isActive('UI') &&
      sceneOf(game).__qaCarryCreatedToken === wantedToken,
    30_000,
    'game scene rebuilt'
  );
  installSpawnGate(game);

  // ЕДИНСТВЕННОЕ различие между эпизодами: кандидат переносит один стак.
  const gs = sceneOf(game);
  if (arm === 'candidate' && mutationId) {
    gs.setQaCarryStack?.(mutationId);
  } else {
    gs.setQaCarryStack?.(null);
  }

  // Снимок «Кровотока»: целевая мутация в нём есть — значит перенос законен.
  const sourceStacks: Record<string, number> = { dmg: 2, rate: 1 };
  if (mutationId) sourceStacks[mutationId] = 1;
  await jumpToHeart(game, sourceStacks);
  const trophy = takeTrophy(game);
  const carryState = gs.qaCarryStackState?.() ?? null;

  // Штатный вход в «Сердце» (после переноса, если он был).
  gs.runState.stage.hp = 100;
  gs.runState.stage.maxHp = 100;

  const gsAny = gs as any;
  const spawnControlled = (kind: string, x: number, y: number, elite = false) => {
    (globalThis as any).__qaAllowSpawn = true;
    return gsAny.__qaOrigSpawn(kind, x, y, elite);
  };

  // ── Счётчики ──────────────────────────────────────────────────────────────
  let kills = 0;
  let damageDealt = 0;
  let damageTaken = 0;
  let bossDamage = 0;
  let bossHpLeft: number | null = null;
  let bossMaxHp: number | null = null;
  let bossKillAtMs: number | null = null;
  const origDamaged = gsAny.__qaOrigDamaged;
  gs.onEnemyDamaged = function (enemy: any, damage: number) {
    damageDealt += damage;
    if (enemy.isBoss) {
      bossDamage += damage;
      bossHpLeft = enemy.hp;
      bossMaxHp = enemy.maxHp;
    }
    return origDamaged.call(this, enemy, damage);
  };
  const origRecord = gsAny.__qaOrigRecord;
  gs.wave.recordPlayerDamage = (damage: number, maxHp: number) => {
    damageTaken += damage;
    return origRecord(damage, maxHp);
  };

  const startedAt = performance.now();
  const deadline = Date.now() + EPISODE_WALL_TIMEOUT_MS;

  // ── Фаза 1: первая волна ─────────────────────────────────────────────────
  for (const e of gs.enemies.getChildren()) {
    if (e.active) e.deactivateForStageReset();
  }
  gs.runState.stage.kills = 0;
  for (let i = 0; i < CROWD; i++) {
    const a = (i / CROWD) * Math.PI * 2;
    spawnControlled('swarm', gs.player.x + Math.cos(a) * CROWD_RADIUS, gs.player.y + Math.sin(a) * CROWD_RADIUS);
  }
  const waveStartedAt = gs.runState.stage.timeMs;
  let waveKills = 0;
  let waveDamage = 0;
  let waveSurvivedMs: number | null = null;
  let endedBy: EpisodeResult['endedBy'] = 'wave-timeout';

  while (Date.now() < deadline) {
    await sleep(100);
    const alive = gs.enemies.countActive(true);
    waveKills = gs.runState.stage.kills;
    waveDamage = damageDealt;
    if (gs.runState.stage.hp <= 0) {
      endedBy = 'death';
      break;
    }
    if (alive === 0) {
      waveSurvivedMs = gs.runState.stage.timeMs - waveStartedAt;
      endedBy = 'wave-cleared';
      break;
    }
    if (gs.runState.stage.timeMs - waveStartedAt > WAVE_TIMEOUT_MS) {
      waveSurvivedMs = gs.runState.stage.timeMs - waveStartedAt;
      endedBy = 'wave-timeout';
      break;
    }
    onLive(
      `Волна: убито ${waveKills}/${CROWD} · урона ${Math.round(waveDamage)} · HP ${Math.round(
        gs.runState.stage.hp
      )}`
    );
  }

  // ── Фаза 2: «КАРДИАЛЬНЫЙ ТИТАН» ─────────────────────────────────────────
  if (endedBy === 'wave-cleared' || endedBy === 'wave-timeout') {
    for (const e of gs.enemies.getChildren()) {
      if (e.active) e.deactivateForStageReset();
    }
    const boss = spawnControlled('boss', gs.player.x + 150, gs.player.y - 120);
    if (boss) {
      gs.wave.boss = boss;
      const bossStartedAt = gs.runState.stage.timeMs;
      while (Date.now() < deadline) {
        await sleep(100);
        if (gs.runState.stage.hp <= 0) {
          endedBy = 'death';
          break;
        }
        if (!boss.active) {
          bossKillAtMs = gs.runState.stage.timeMs - bossStartedAt;
          endedBy = 'boss-dead';
          break;
        }
        if (gs.runState.stage.timeMs - bossStartedAt > BOSS_TIMEOUT_MS) {
          endedBy = 'boss-timeout';
          break;
        }
        onLive(
          `Титан: HP ${Math.round(boss.hp)}/${Math.round(boss.maxHp)} · урона ${Math.round(
            bossDamage
          )} · ваши HP ${Math.round(gs.runState.stage.hp)}`
        );
      }
    }
  }

  kills = gs.runState.stage.kills;
  const survivedMs = performance.now() - startedAt;
  return {
    episode,
    arm,
    seed,
    mutationId: carryState?.appliedId ?? null,
    carriedStacks: carryState?.appliedStacks ?? null,
    kills,
    damageDealt: Math.round(damageDealt),
    damageTaken: Math.round(damageTaken),
    waveKills,
    waveDamageDealt: Math.round(waveDamage),
    waveSurvivedMs,
    bossDamage: Math.round(bossDamage),
    bossHpLeft: bossHpLeft === null ? null : Math.round(bossHpLeft),
    bossMaxHp: bossMaxHp === null ? null : Math.round(bossMaxHp),
    bossKillAtMs,
    survivedMs: Math.round(survivedMs),
    endedBy,
    hpLeft: Math.round(gs.runState.stage.hp),
    level: gs.runState.stage.level,
    projectiles: gs.runState.stage.projectiles,
    trophy,
  };
}

const END_LABEL: Record<EpisodeResult['endedBy'], string> = {
  'wave-timeout': 'волна не зачищена за отведённое время',
  'wave-cleared': 'волна зачищена',
  'boss-dead': 'ТИТАН УБИТ',
  'boss-timeout': 'Титан не убит за отведённое время',
  death: 'смерть',
};

function renderResult(r: EpisodeResult): string {
  const arm = r.arm === 'candidate' ? 'С ПЕРЕНОСОМ СТАКА' : 'КОНТРОЛЬ (штатный сброс)';
  return [
    `<div style="font-size:18px;font-weight:800">Эпизод ${r.episode}: ${arm}</div>`,
    `<div>Мутация: <b>${r.mutationId ?? '—'}</b> · перенесено стаков: <b>${
      r.carriedStacks ?? 0
    }</b></div>`,
    `<div>Волна: убито <b>${r.waveKills}/${CROWD}</b> · урона <b>${r.waveDamageDealt}</b></div>`,
    `<div>Титан: урона <b>${r.bossDamage}</b> · HP босса <b>${r.bossHpLeft ?? '—'}/${
      r.bossMaxHp ?? '—'
    }</b>${r.bossKillAtMs !== null ? ` · убит за <b>${(r.bossKillAtMs / 1000).toFixed(1)} с</b>` : ''}</div>`,
    `<div>Итого: убийств <b>${r.kills}</b> · потери <b>${r.damageTaken}</b> · осталось HP <b>${
      r.hpLeft
    }</b></div>`,
    `<div>Итог: <b>${END_LABEL[r.endedBy]}</b></div>`,
  ].join('');
}

export function startCarryPairQA(game: Phaser.Game): void {
  const params = new URLSearchParams(location.search);
  if (params.get('qa') !== QA_PARAM) return;
  const rawSeed = params.get('seed') ?? '';
  const seed = /^[a-zA-Z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : 'phone-carry-1';
  const mutationId = params.get('mut') || 'multi';
  const fast = params.get('fast') === '1';
  const overlay = makeOverlay();

  const PLAN: { arm: 'control' | 'candidate' }[] = [
    { arm: 'control' },
    { arm: 'candidate' },
  ];
  const results: EpisodeResult[] = [];

  const persist = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(results.filter(Boolean)));
    } catch {
      /* приватный режим */
    }
  };

  const title = (i: number) =>
    `Эпизод ${i + 1}: ${
      PLAN[i].arm === 'candidate'
        ? `С ПЕРЕНОСОМ СТАКА «${mutationId.toUpperCase()}»`
        : 'КОНТРОЛЬ (штатный сброс)'
    }`;

  const runFrom = (i: number) => {
    if (i >= PLAN.length) {
      const json = JSON.stringify(results.filter(Boolean), null, 2);
      overlay.show(
        [
          ...results.filter(Boolean).map((r) => renderResult(r)),
          '<hr style="border:0;border-top:1px solid #ffffff22;margin:8px 0">',
          `<div style="margin-top:8px;opacity:.85">Итог сохранён в localStorage: <code>${STORE_KEY}</code></div>`,
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

    overlay.show(`<div>${title(i)}: загрузка…</div>`);
    void (async () => {
      try {
        const r = await runEpisode(
          game,
          seed,
          PLAN[i].arm,
          i + 1,
          mutationId,
          (t) =>
            overlay.show(
              `<div style="font-size:20px;font-weight:800">${title(i)}</div><div>${t}</div>`
            ),
          fast
        );
        results[i] = r;
        persist();
        overlay.show(renderResult(r));
        overlay.body.appendChild(
          button(
            i + 1 < PLAN.length ? `Далее: ${title(i + 1)}` : 'Показать оба эпизода',
            () => runFrom(i + 1)
          )
        );
      } catch (error) {
        overlay.show(
          `<div style="color:#ff8a7a">Эпизод ${i + 1} не завершён: ${String(error)}</div>`
        );
      }
    })();
  };

  overlay.show(
    [
      '<div style="font-size:24px;font-weight:800">QA: перенос одного стака в «Сердце»</div>',
      '<div>Два коротких боя с <b>одинаковым стартом</b>: контроль (штатный сброс) и с переносом одного стака мутации.</div>',
      `<div>Переносимая мутация: <b>${mutationId.toUpperCase()}</b> (взять другую: <code>?mut=pierce</code>).</div>`,
      '<div>В каждом эпизоде: первая волна из 28 клеток, затем «КАРДИАЛЬНЫЙ ТИТАН». Играйте обычным движением.</div>',
      '<div>Итог каждого эпизода сохраняется сразу и переживает смерть.</div>',
      `<div style="opacity:.7">сид: ${seed}</div>`,
    ].join('')
  );
  overlay.body.appendChild(button('Начать эпизод 1', () => runFrom(0)));
}
