import {
  UPGRADE_FAMILY_LABELS,
  UPGRADES,
  type ChoiceKind,
  type UpgradeFamily,
  type UpgradeRarity,
} from './UpgradeSystem';
import { fmtInt } from './UiFormat';

/**
 * Player-visible RU copy catalog for interface surfaces that previously carried
 * inline literals in scene code.
 *
 * Scope: display-only strings (rarity words, card headers, build-summary
 * abbreviations). Not a localization layer and not a runtime i18n module —
 * the canonical vocabulary stays in docs/GAME_LANGUAGE_BIBLE.md.
 *
 * Every value here must equal the literal it replaced. See tests/ui-copy-catalog.mjs.
 */

/** Rarity words that appear in the `[СЕМЬЯ] · [РЕДКОСТЬ]` mutation card header. */
export const RARITY_LABELS: Record<'common' | 'rare', string> = {
  common: 'СТАНДАРТ',
  rare: 'РЕДКИЙ',
};

/**
 * Headers for the two special mutation cards. They replace the family/rarity
 * line entirely, so they deliberately live outside `RARITY_LABELS`.
 */
export const MUTATION_CARD_HEADERS: Record<'legendary' | 'evolution', string> = {
  legendary: 'ЛЕГЕНДАРНАЯ МУТАЦИЯ',
  evolution: 'КРИТИЧЕСКАЯ МУТАЦИЯ',
};

export interface MutationCardHeaderSource {
  family: UpgradeFamily;
  rarity: UpgradeRarity;
  kind?: ChoiceKind;
}

/**
 * Header line of a mutation card. Legendary/evolution cards drop the
 * family/rarity line; every other card renders `[СЕМЬЯ] · [РЕДКОСТЬ]`.
 */
export function mutationCardHeader(def: MutationCardHeaderSource): string {
  if (def.kind === 'legendary') return MUTATION_CARD_HEADERS.legendary;
  if (def.kind === 'evolution') return MUTATION_CARD_HEADERS.evolution;
  return `${UPGRADE_FAMILY_LABELS[def.family]} · ${
    RARITY_LABELS[def.rarity === 'rare' ? 'rare' : 'common']
  }`;
}

/**
 * Short upgrade abbreviations for the run build summary (result screen).
 * Coverage of `UPGRADES` ids is asserted by tests/ui-copy-catalog.mjs.
 */
export const BUILD_SUMMARY_LABELS: Record<string, string> = {
  dmg: 'ШИПЫ',
  rate: 'РЕПЛИКАЦИЯ',
  multi: 'КОПИИ',
  pierce: 'ПРОБИТИЕ',
  speed: 'СКОРОСТЬ',
  hp: 'КАПСИД',
  magnet: 'МАГНИТ',
  orbit: 'СПУТНИКИ',
  nova: 'ИМПУЛЬС',
  regen: 'РЕГЕН.',
  infect: 'ЗАРАЖЕНИЕ',
  lysis: 'ЦИТОЛИЗ',
  factory: 'ФАБРИКА',
};

export const BUILD_SUMMARY_LIMIT = 5;

/**
 * `[СЕМЬЯ] · [РЕДКОСТЬ]`-independent summary of the strongest stacks of a run:
 * known upgrade ids only, count above zero, sorted by count (descending),
 * capped at {@link BUILD_SUMMARY_LIMIT} entries.
 */
export function formatBuildSummary(stacks: Record<string, number>): string {
  return Object.entries(stacks)
    .filter(([id, n]) => n > 0 && UPGRADES.some((u) => u.id === id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, BUILD_SUMMARY_LIMIT)
    .map(([id, n]) => `${BUILD_SUMMARY_LABELS[id] ?? id.toUpperCase()} ${n}`)
    .join(' · ');
}

/* ------------------------------------------------------------------------- *
 * UI redesign v1 — the player-facing copy of the redesigned surfaces.
 *
 * Every string a redesigned screen shows lives here, so the copy contract test
 * can pin it as a literal instead of reading it back from the implementation.
 * ------------------------------------------------------------------------- */

/** Main menu copy. */
export const MENU_COPY = {
  /** The product statement. Two lines, unchanged. */
  hook: 'СИНТЕТИЧЕСКИЙ ВИРУС.\nЖИВОЙ ОРГАНИЗМ.',
  /** The one-line product promise. */
  tagline: 'Выживай. Поглощай РНК. Эволюционируй.',
  /** Primary action of a fresh menu. */
  start: 'НАЧАТЬ ЗАРАЖЕНИЕ',
  /** Primary action when a checkpoint exists. */
  resume: 'ПРОДОЛЖИТЬ ЗАБЕГ',
  /** Secondary action when a checkpoint exists. */
  newRun: 'НОВЫЙ ЗАБЕГ',
  /** Says that the run-configuration cards belong to the next run. */
  nextRunHint: 'Сложность и управление — для следующего забега',
  /** Top-level destinations. */
  rating: 'РЕЙТИНГ',
  tasks: 'ЗАДАЧИ ДНЯ',
  codex: 'КОДЕКС',
  collection: 'КОЛЛЕКЦИЯ',
  /** Footer row. */
  legal: 'О приложении · Политика · Поддержка',
  /** Labels of the three audio switches. */
  music: 'Музыка',
  sound: 'Звук',
  effects: 'Эффекты',
  on: 'вкл',
  off: 'выкл',
} as const;

/** Result screen copy. */
export const RESULT_COPY = {
  /** Small header above the outcome. */
  header: 'ИТОГ ЗАБЕГА',
  /** Defeat outcome. */
  defeat: 'ШТАММ УНИЧТОЖЕН',
  /** Victory outcome. */
  victory: 'НОСИТЕЛЬ ЗАРАЖЁН',
  /** Primary action. */
  newRun: 'НОВЫЙ ЗАБЕГ',
  /** Legacy result sharing. */
  challenge: 'БРОСИТЬ ВЫЗОВ ДРУГУ',
  /** Verified fixed-seed duel. */
  duel: 'ВЫЗВАТЬ НА ДУЭЛЬ',
  /** Plain result share, when no challenge or duel can be created. */
  share: 'ПОДЕЛИТЬСЯ РЕЗУЛЬТАТОМ',
  /** Tertiary action. */
  menu: 'В МЕНЮ',
  /** Full copy of a critical mutation in the result. */
  critical: 'КРИТИЧЕСКАЯ МУТАЦИЯ',
  /** Full copy of a legendary mutation in the result. */
  legendary: 'ЛЕГЕНДАРНАЯ МУТАЦИЯ',
  /** Neutral status of a resumed, therefore unranked, run. */
  resumed: 'Тренировка · продолженный забег',
  /** Daily board place. */
  dailyRank: (rank: number): string => `★ МЕСТО #${rank} В РЕЙТИНГЕ ДНЯ`,
} as const;

/** Copy of the three meta surfaces and of the rating surface. */
/**
 * Friendly name of the host platform.
 *
 * The raw host string can be an internal client token (Telegram Desktop reports
 * `tdesktop`), so it never reaches the player: the About surface and the
 * hidden diagnostics target name the kind of the host instead.
 */
export function platformLabel(kind: string): string {
  switch (kind) {
    case 'max': return 'MAX';
    case 'telegram': return 'Telegram';
    default: return 'Браузер';
  }
}

export const META_COPY = {
  /** Title of the rating surface. */
  rating: 'РЕЙТИНГ',
  /** Title of the daily tasks surface. */
  tasks: 'ЗАДАЧИ ДНЯ',
  /** Title of the codex surface. */
  codex: 'КОДЕКС',
  /** Title of the collection surface. */
  collection: 'КОЛЛЕКЦИЯ',
  /** Collection tabs. */
  shells: 'ОБОЛОЧКИ',
  milestones: 'ВЕХИ',
  lab: 'ЛАБОРАТОРИЯ',
  /** The one explanation a shell list needs. */
  shellsNote: 'Оболочки меняют только внешний вид — на силу штамма не влияют',
  /** Selected shell state. */
  active: '✓ АКТИВЕН',
  /** Locked shell state. */
  locked: 'ЗАКРЫТО',
  /** Codex mastery section. */
  mastery: 'ПРОХОЖДЕНИЕ РЕЖИМОВ',
  /** Daily tasks progress line. */
  tasksProgress: (completed: number, total: number, remaining: string): string =>
    `Выполнено: ${completed} из ${total} · Обновление через ${remaining}`,
  /** Completed task state. */
  taskComplete: '◆ ВЫПОЛНЕНО',
  /** Empty state of the daily streak. */
  streakEmpty: 'Сыграй забег дня, чтобы начать серию',
  /** Empty state of the friends list. */
  friendsEmpty: 'Здесь появятся результаты друзей, которые играют в OFELIYA.',
  /** Invite call to action. */
  inviteFriends: 'ПРИГЛАСИТЬ ДРУЗЕЙ',
  /** Network failure of the rating surface. */
  networkError: 'НЕТ СОЕДИНЕНИЯ',
  serverError: 'СЕРВЕР НЕ ОТВЕТИЛ',
  /** Retry call to action. */
  retry: 'ПОВТОРИТЬ',
  /** Neutral player label when the payload carries no display name. */
  player: (platform: string): string => `Игрок (${platform})`,
} as const;

/** The bot handle every share text points at. */
export const SHARE_BOT_HANDLE = '@ofeliya_game_bot';

/** The invite text of the empty friends list. */
export function buildInviteText(): string {
  return `OFELIYA — сыграй и сравни результат. ${SHARE_BOT_HANDLE}`;
}

/**
 * Terms that must never appear in a player-facing share text.
 *
 * The share text leaves the game, so it must not carry internal vocabulary, a
 * strain code, a profile label, a ranking disclaimer or a same-seed promise.
 */
export const SHARE_FORBIDDEN_TERMS = [
  'STRAIN-0',
  'Профиль штамма',
  'вне рейтинга',
  'выжил',
  'тот же забег',
  'тот же штамм',
] as const;

export interface ShareCopyInput {
  /** Victory or defeat. */
  win: boolean;
  /** Formatted run time, `MM:SS`. */
  time: string;
  /** Kills in the run. */
  kills: number;
  /** Host cells infected in the run. */
  infected: number;
  /** Optional mode line, e.g. `Ежедневный забег.`. */
  mode?: string;
  /** Optional mutation summary, e.g. `Легендарные: НУЛЕВАЯ ТОЧКА.` */
  extra?: string;
  /** Optional trailing block, e.g. the daily streak summary. */
  suffix?: string;
}

/**
 * The share text of a finished run.
 *
 * `OFELIYA` is the first word, the sentence is readable outside the game, and a
 * defeat says "продержался" — never "выжил". The text never names the strain, never
 * names the build profile, never claims a ranking status and never promises the
 * same seed.
 */
export function buildShareText(input: ShareCopyInput): string {
  const kills = fmtInt(input.kills);
  const infected = fmtInt(input.infected);
  const headline = input.win
    ? `OFELIYA — носитель заражён за ${input.time}.`
    : `OFELIYA — штамм продержался ${input.time}.`;
  const stats = `Уничтожено: ${kills} · заражено клеток: ${infected}.`;
  const call = input.win ? 'Сможешь быстрее?' : 'Сможешь дольше?';
  const mode = input.mode ? `${input.mode} ` : '';
  const extra = input.extra ? `${input.extra} ` : '';
  const suffix = input.suffix ? `\n\n${input.suffix}` : '';
  return `${headline} ${stats} ${mode}${extra}${call} ${SHARE_BOT_HANDLE}${suffix}`;
}

/** The share text of a created fixed-seed duel. */
export function buildDuelShareText(targetTime: string): string {
  return `OFELIYA · ДУЭЛЬ: мой результат ${targetTime}. Сможешь пройти быстрее? ${SHARE_BOT_HANDLE}`;
}