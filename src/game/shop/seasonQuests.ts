/**
 * Season quests — сезонные миссии (монетизация v3).
 *
 * Отдельный лёгкий модуль, НЕ часть дневного движка (src/quests/questEngine):
 * дневной движок day-scoped с жёстким правилом «ядро не выдаёт ценность»
 * (questTypes.ts, правило 1) и не умеет месячную аккумуляцию; встраивать
 * в него сезон — большой рефактор ради одной фичи. Сезонный модуль живёт
 * своей жизнью: свой стейт, свой сезон, свои локальные гранты.
 *
 * Модуль намеренно лежит ВНЕ src/quests/: check-quest-core.mjs сканирует
 * КАЖДЫЙ .ts в src/quests/ и запрещает value-поля (amount/balance/price/
 * grantRna — «награда принадлежит серверу»). Сезонные миссии выдают
 * ценность по дизайну (локальные гранты), поэтому жить в этой папке они
 * не могут — это не обход гейта, а его соблюдение: гейт защищает дневное
 * ядро, а сезон — отдельный модуль монетизации рядом с витриной.
 *
 * Модель доверия — как у DailyCalendar и мета-достижений: награды
 * ЛОКАЛЬНЫЕ (grantMetaRna / бустер / скин через те же фасады, что и
 * остальная игра). Серверного подтверждения нет — это не платёжные
 * гранты, а retention-награды; читерство через localStorage даёт только
 * косметику/РНК, как и в Daily. Награды — НЕ статы: ни одна миссия не
 * даёт постоянной силы (AGENTS.md: Codex/mastery — информационный
 * прогресс; лаборатория как stat-grind НЕ активируется).
 *
 * Сезон = календарный месяц UTC (`YYYY-MM`), как UTC-день у дневных
 * квестов. Смена сезона обнуляет прогресс и claimed (награды прошлого
 * сезона сгорают — игрок видит это в доске заданий).
 *
 * Треки: free — для всех; paid — только с активным сезонным пропуском
 * (MetaWallet.isSeasonPassActive). Прогресс paid-миссий копится ВСЕГДА,
 * даже без пропуска (стандартное поведение battle pass: купил позже —
 * забрал накопленное). Гейт — только на claim.
 *
 * Каталог v1 — фиксированный, одинаковый каждый сезон (6 миссий).
 * Сезонная ротация каталога — отдельный шаг (нужен дизайн-контент).
 *
 * Хранение: localStorage `ofeliya.season-quests.v1` + in-memory fallback
 * для Node (как MetaWallet). Формат: {version:1, seasonId, progress,
 * claimed}. Битый JSON / неверная версия → чистое состояние сезона.
 */
import { getBoosterUntilMs, isSeasonPassActive, setBoosterUntilMs } from '../meta/MetaWallet';
import { grantMetaRna } from '../lab/LabState';
import { grantSkin } from '../skins/SkinOwnership';

export type SeasonMetric = 'runs' | 'kills' | 'rna' | 'bosses' | 'mutations';
export type SeasonTrack = 'free' | 'paid';

export type SeasonReward =
  | { kind: 'rna'; amount: number }
  | { kind: 'booster'; days: number }
  | { kind: 'skin'; skinId: string };

export interface SeasonMissionDef {
  readonly id: string;
  readonly title: string;
  readonly desc: string;
  readonly metric: SeasonMetric;
  readonly target: number;
  readonly track: SeasonTrack;
  readonly reward: SeasonReward;
}

/**
 * Каталог v1 (6 миссий). Цели — на месяц регулярной игры (~2–3 забега
 * в день дают ~60–90 забегов, ~3–6 тыс. убийств). Награды free-трека —
 * ~1400 РНК за сезон; paid — 1000 РНК + 3 дня бустера ×2.
 */
export const SEASON_MISSIONS: readonly SeasonMissionDef[] = [
  {
    id: 'season.runs-10',
    title: 'Десять забегов',
    desc: 'Завершите 10 забегов за сезон',
    metric: 'runs',
    target: 10,
    track: 'free',
    reward: { kind: 'rna', amount: 200 },
  },
  {
    id: 'season.kills-500',
    title: 'Пятьсот уничтоженных',
    desc: 'Уничтожьте 500 врагов за сезон',
    metric: 'kills',
    target: 500,
    track: 'free',
    reward: { kind: 'rna', amount: 300 },
  },
  {
    id: 'season.rna-5000',
    title: 'Сборщик РНК',
    desc: 'Соберите 5000 РНК за сезон',
    metric: 'rna',
    target: 5000,
    track: 'free',
    reward: { kind: 'rna', amount: 400 },
  },
  {
    id: 'season.bosses-3',
    title: 'Охотник на боссов',
    desc: 'Победите 3 боссов за сезон',
    metric: 'bosses',
    target: 3,
    track: 'free',
    reward: { kind: 'rna', amount: 500 },
  },
  {
    id: 'season.kills-2000',
    title: 'Две тысячи уничтоженных',
    desc: 'Уничтожьте 2000 врагов за сезон',
    metric: 'kills',
    target: 2000,
    track: 'paid',
    reward: { kind: 'rna', amount: 1000 },
  },
  {
    id: 'season.mutations-50',
    title: 'Пятьдесят мутаций',
    desc: 'Выберите 50 мутаций за сезон',
    metric: 'mutations',
    target: 50,
    track: 'paid',
    reward: { kind: 'booster', days: 3 },
  },
];

export const SEASON_QUESTS_KEY = 'ofeliya.season-quests.v1';
const DAY_MS = 86_400_000;

export interface SeasonState {
  version: 1;
  seasonId: string;
  progress: Partial<Record<SeasonMetric, number>>;
  claimed: string[];
}

interface SeasonTotals {
  kills: number;
  rnaCollected: number;
  bossesDefeated: number;
  mutations: number;
}

export interface SeasonMissionProgress {
  readonly def: SeasonMissionDef;
  readonly progress: number;
  readonly complete: boolean;
  readonly claimed: boolean;
  /** Можно забрать прямо сейчас (выполнена, не забрана, трек доступен). */
  readonly claimable: boolean;
}

export type ClaimReason = 'unknown' | 'not-complete' | 'already-claimed' | 'pass-required';

export interface ClaimResult {
  ok: boolean;
  reason?: ClaimReason;
  /** Фактически выдано (с множителями grantMetaRna — см. LabState). */
  grantedRna?: number;
  grantedBoosterDays?: number;
  grantedSkinId?: string;
}

const memFallback: { state: SeasonState | null } = { state: null };

/** Сезон = календарный месяц UTC: `YYYY-MM` (как UTC-день у дневных квестов). */
export function seasonIdFor(nowMs: number): string {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Человекочитаемое имя сезона для UI: «Ноябрь 2026». */
export function seasonDisplayName(seasonId: string): string {
  const [y, m] = seasonId.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return seasonId;
  const MONTHS = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
  ];
  return `${MONTHS[m - 1]} ${y}`;
}

function emptyState(seasonId: string): SeasonState {
  return { version: 1, seasonId, progress: {}, claimed: [] };
}

function sanitize(raw: unknown, seasonId: string): SeasonState {
  const st = emptyState(seasonId);
  if (!raw || typeof raw !== 'object') return st;
  const r = raw as Partial<SeasonState>;
  if (r.version !== 1) return st;
  if (typeof r.seasonId === 'string' && r.seasonId !== seasonId) return st;
  const n = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  const p = (r.progress ?? {}) as Partial<Record<SeasonMetric, number>>;
  for (const k of ['runs', 'kills', 'rna', 'bosses', 'mutations'] as const) {
    if (typeof p[k] === 'number') st.progress[k] = n(p[k]);
  }
  if (Array.isArray(r.claimed)) {
    st.claimed = r.claimed.filter(
      (id): id is string =>
        typeof id === 'string' && SEASON_MISSIONS.some((d) => d.id === id)
    );
  }
  return st;
}

function loadRaw(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(SEASON_QUESTS_KEY);
  } catch {
    return null;
  }
}

function saveRaw(raw: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SEASON_QUESTS_KEY, raw);
  } catch {
    // Ограниченный WebView: работаем в памяти.
  }
}

/**
 * Загрузить состояние сезона. Смена сезона (хранится старый seasonId) —
 * чистое состояние нового сезона (прогресс и claimed прошлого сгорают).
 * Никогда не бросает.
 */
export function loadSeasonState(nowMs: number = Date.now()): SeasonState {
  const seasonId = seasonIdFor(nowMs);
  try {
    const raw = loadRaw();
    if (raw === null) {
      if (memFallback.state && memFallback.state.seasonId === seasonId) {
        return memFallback.state;
      }
      return emptyState(seasonId);
    }
    const parsed = JSON.parse(raw) as unknown;
    return sanitize(parsed, seasonId);
  } catch {
    return emptyState(seasonId);
  }
}

function saveSeasonState(state: SeasonState): void {
  memFallback.state = state;
  try {
    saveRaw(JSON.stringify(state));
  } catch {
    // Игнорируем: in-memory копия уже обновлена.
  }
}

/** Сброс для тестов. */
export function debugResetSeasonQuests(): void {
  memFallback.state = null;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(SEASON_QUESTS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Зафиксировать итоги забега: +1 к runs, метрики — в прогресс сезона.
 * Вызывается из GameScene.endRun (один раз на забег). Отрицательные /
 * нечисловые входы игнорируются (fail-closed). Возвращает состояние.
 */
export function recordSeasonRun(totals: SeasonTotals, nowMs: number = Date.now()): SeasonState {
  const st = loadSeasonState(nowMs);
  const add = (k: SeasonMetric, v: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
    st.progress[k] = Math.floor((st.progress[k] ?? 0) + v);
  };
  st.progress.runs = Math.floor((st.progress.runs ?? 0) + 1);
  add('kills', totals.kills);
  add('rna', totals.rnaCollected);
  add('bosses', totals.bossesDefeated);
  add('mutations', totals.mutations);
  saveSeasonState(st);
  return st;
}

/** Снапшот миссий сезона для UI (только чтение). */
export function seasonSnapshot(nowMs: number = Date.now()): SeasonMissionProgress[] {
  const st = loadSeasonState(nowMs);
  const passActive = isSeasonPassActive(nowMs);
  return SEASON_MISSIONS.map((def) => {
    const progress = st.progress[def.metric] ?? 0;
    const complete = progress >= def.target;
    const claimed = st.claimed.includes(def.id);
    const trackOpen = def.track === 'free' || passActive;
    return { def, progress, complete, claimed, claimable: complete && !claimed && trackOpen };
  });
}

/**
 * Забрать награду миссии. Грант — локальный (grantMetaRna / бустер /
 * скин — те же фасады, что у Daily и достижений). Пометка claimed
 * ставится ДО гранта? Нет — ПОСЛЕ: если грант бросит, claimed не
 * ставится, игрок сможет повторить. Никогда не бросает.
 */
export function claimSeasonMission(id: string, nowMs: number = Date.now()): ClaimResult {
  const def = SEASON_MISSIONS.find((d) => d.id === id);
  if (!def) return { ok: false, reason: 'unknown' };
  const st = loadSeasonState(nowMs);
  const progress = st.progress[def.metric] ?? 0;
  if (progress < def.target) return { ok: false, reason: 'not-complete' };
  if (st.claimed.includes(id)) return { ok: false, reason: 'already-claimed' };
  if (def.track === 'paid' && !isSeasonPassActive(nowMs)) {
    return { ok: false, reason: 'pass-required' };
  }
  try {
    let result: ClaimResult;
    if (def.reward.kind === 'rna') {
      const { granted } = grantMetaRna(def.reward.amount);
      result = { ok: true, grantedRna: granted };
    } else if (def.reward.kind === 'booster') {
      const ms = def.reward.days * DAY_MS;
      setBoosterUntilMs(Math.max(nowMs, getBoosterUntilMs()) + ms);
      result = { ok: true, grantedBoosterDays: def.reward.days };
    } else {
      // grantSkin=false — скин уже есть (или неизвестный id): награда
      // считается забранной, но grantedSkinId не отчитываем.
      const granted = grantSkin(def.reward.skinId, 'achievement');
      result = { ok: true, grantedSkinId: granted ? def.reward.skinId : undefined };
    }
    st.claimed.push(id);
    saveSeasonState(st);
    return result;
  } catch {
    return { ok: false, reason: 'unknown' };
  }
}

/** Забрать все доступные награды сразу (кнопка «Забрать всё» в доске). */
export function claimAllSeasonMissions(nowMs: number = Date.now()): {
  claimed: string[];
  grantedRna: number;
  grantedBoosterDays: number;
  grantedSkins: string[];
} {
  const out = { claimed: [] as string[], grantedRna: 0, grantedBoosterDays: 0, grantedSkins: [] as string[] };
  for (const p of seasonSnapshot(nowMs)) {
    if (!p.claimable) continue;
    const r = claimSeasonMission(p.def.id, nowMs);
    if (!r.ok) continue;
    out.claimed.push(p.def.id);
    out.grantedRna += r.grantedRna ?? 0;
    out.grantedBoosterDays += r.grantedBoosterDays ?? 0;
    if (r.grantedSkinId) out.grantedSkins.push(r.grantedSkinId);
  }
  return out;
}
