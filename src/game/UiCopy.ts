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
  /**
   * Says that the run-configuration cards belong to the next run.
   *
   * The wording is the canonical one of the source of truth: the cards are
   * marked "для нового забега", never "для следующего".
   */
  nextRunHint: 'Для нового забега',
  /** Top-level destinations. */
  rating: 'РЕЙТИНГ',
  tasks: 'ЗАДАЧИ ДНЯ',
  codex: 'КОДЕКС',
  collection: 'КОЛЛЕКЦИЯ',
  /** Footer row. */
  legal: 'О приложении · Политика · Поддержка',
  /** Labels of the three audio switches. The music switch carries its glyph. */
  music: '♪ Музыка',
  sound: 'Звук',
  effects: 'Эффекты',
  on: 'вкл',
  off: 'выкл',
  /**
   * The step of the difficulty scale, shown next to the value of the card.
   *
   * The scale has three shipped steps: EASY, STANDARD and STRAINED.
   * The selector and its dots are data-driven by the current difficulty id.
   */
  difficultySteps: {
    easy: '• ◦ ◦',
    standard: '• • ◦',
    strained: '• • •',
  },
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
  /**
   * Full copy of a critical mutation in the result.
   *
   * The line never uses the "КРИТ." abbreviation and it never renders an empty
   * value: the whole row is skipped when the run unlocked no critical mutation.
   */
  critical: 'Критические мутации',
  /** Full copy of a legendary mutation in the result. */
  legendary: 'ЛЕГЕНДАРНАЯ МУТАЦИЯ',
  /** Neutral status of a resumed, therefore unranked, run. */
  resumed: 'Тренировка (продолженный забег)',
  /** Daily board place. */
  dailyRank: (rank: number): string => `★ МЕСТО #${rank} В РЕЙТИНГЕ ДНЯ`,
  /**
   * The status of a daily submission.
   *
   * Every server state keeps its own line: the player has to know whether the
   * run counted, whether the day is already over, or whether the game simply
   * could not reach the server. The wording never exposes the implementation.
   */
  dailyStatus: {
    ok: 'Забег дня засчитан',
    rejected: 'Забег дня не засчитан',
    closed: 'Забег дня уже закрыт',
    expired: 'Срок забега дня истёк',
    denied: 'Нужен запуск через MAX или Telegram',
    http: 'Сервер не ответил',
    network: 'Нет соединения',
    unavailable: 'Не удалось определить профиль',
  } as const,
  /** The daily run was blocked before it could be sent. */
  dailyBlocked: 'Забег дня не засчитан',
  /** The duel attempt could not be confirmed by the server. */
  duelUnconfirmed: 'Дуэль не засчитана',
  /**
   * The transient state of a result that is on its way to the server.
   *
   * The player sees a sentence, not the name of the request: the word
   * "synchronization" describes the implementation, not the game.
   */
  submitting: 'Отправляю результат…',
  duelSubmitting: 'Отправляю дуэль…',
} as const;

/**
 * The mode chip of the result screen.
 *
 * The chip names the mode and, when the run counts, the board it counts for.
 * A run that does not count is a training run: the chip never says
 * "вне рейтинга", which is an internal anti-cheat flag.
 */
export const RESULT_MODE_CHIP = {
  /** A run continued from a checkpoint. */
  practice: 'Тренировка (продолженный забег)',
  /** A fresh standard run that the server ranked. */
  ranked: 'СТАНДАРТ · В зачёт рейтинга',
  /** A run launched from the daily ticket. */
  daily: 'ЗАБЕГ ДНЯ · СТАНДАРТ',
  /** A fixed-seed duel. */
  duel: 'ДУЭЛЬ · СТАНДАРТ',
  /** A fresh Easy run: beginner mode, never ranked. */
  easy: 'ЛЁГКИЙ · Тренировка',
  /** A fresh strained run: the server does not rank it. */
  strained: 'НАПРЯЖЕНИЕ · Тренировка',
  /** A local run with no server behind it. */
  local: 'СТАНДАРТ · Тренировка',
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
  /**
   * Codex header.
   *
   * The header names the open records and the run count. It never names the
   * achievement counter: the achievements live in the collection as milestones.
   */
  codexSubtitle: (unlocked: number, total: number, runs: number): string =>
    `Открыто записей: ${unlocked}/${total} · Забегов: ${runs}`,
  /** Daily tasks progress line. */
  tasksProgress: (completed: number, total: number, remaining: string): string =>
    `Выполнено: ${completed} из ${total} · Обновление через ${remaining}`,
  /** Completed task state. */
  taskComplete: '◆ ВЫПОЛНЕНО',
  /** The rest of a daily task. One stays, many are left. */
  remaining: (count: number): string => (count === 1 ? `остался ${count}` : `осталось ${count}`),
  /** Empty state of the daily streak. */
  streakEmpty: 'Сыграй забег дня, чтобы начать серию',
  /** The streak of the player, with its unit. */
  streak: (current: number, best: number): string => `Серия: ${current} дн. · Рекорд: ${best} дн.`,
  /** The streak of a player who has not played a daily run yet. */
  streakEmptyWithBest: (best: number): string =>
    `Сыграй забег дня, чтобы начать серию · Рекорд: ${best} дн.`,
  /** Empty state of the friends list. */
  friendsEmpty: 'Здесь появятся результаты друзей, которые играют через @ofeliya_game_bot.',
  /** Invite call to action. */
  inviteFriends: 'ПРИГЛАСИТЬ ДРУЗЕЙ',
  /** Network failure of the rating surface. */
  networkError: 'Нет соединения с сервером. Твой прогресс сохраняется.',
  /** Server failure of the rating surface. */
  serverError: 'Сервер не ответил. Твой прогресс сохраняется.',
  /** Retry call to action. */
  retry: 'ПОВТОРИТЬ',
  /** The daily launch failed and the player may try again. */
  dailyLaunchRetry: 'ПОВТОРИТЬ',
  /** The daily launch could not reach the server. */
  dailyLaunchServerError: 'Сервер не ответил — попробуй ещё раз',
  /** The daily launch could not reach the network. */
  dailyLaunchNetworkError: 'Нет соединения — попробуй ещё раз',
  /** The daily run is not available at the moment. */
  dailyLaunchCapacity: 'Забег дня сейчас недоступен — попробуй позже',
  /** Neutral player label when the payload carries no display name. */
  player: (platform: string): string => `Игрок (${platform})`,
  /** The call to action of the daily run. */
  dailyCta: 'НАЧАТЬ ЗАБЕГ ДНЯ',
  /** Empty state of the daily section: the player has not played today. */
  dailyEmpty: 'Сегодня ты ещё не играл',
  /** The daily row of the player. */
  dailyRow: (name: string, time: string, kills: string, rank: number | null): string =>
    rank == null
      ? `${name} · ${time} · уничтожено ${kills}`
      : `${name} · ${time} · уничтожено ${kills} · ★ место #${rank}`,
  /** The season header. */
  seasonTitle: (season: number, daysLeft: number): string =>
    `СЕЗОН ${season} · осталось ${daysLeft} дн.`,
  /** One row of the season table. */
  seasonRow: (rank: number, name: string, time: string, kills: string): string =>
    `#${rank} · ${name} — ${time} · ${kills} кл.`,
  /**
   * The group header of the kill milestones.
   *
   * The counter is the collection's own progress window — the kills the
   * milestone system has counted since it started — and not the lifetime total
   * of the profile. The label says so, because "всего" would promise a lifetime
   * number the collection does not keep.
   */
  milestoneKillsGroup: (totalKills: number): string =>
    `Уничтожение иммунных клеток (в прогрессе вех: ${fmtInt(totalKills)})`,
  /** The condition of a shell that is still locked. */
  shellLockedBy: (milestone: string): string => `Чтобы открыть: выполни веху «${milestone}»`,
  /** The condition of a shell that is already open. */
  shellUnlockedBy: (milestone: string): string => `Открыто за веху «${milestone}»`,
  /**
   * The plate of the result screen that names the records the run opened.
   *
   * The count is written with the right grammatical number, and the plate is a
   * way into the codex, not a decoration.
   */
  codexEntries: (count: number): string =>
    `★ Открыто в Кодексе: +${count} ${count === 1 ? 'запись' : count < 5 ? 'записи' : 'записей'}`,
  /** The line of the result screen that names the records of the run. */
  newRecords: (records: string[]): string => `НОВЫЕ РЕКОРДЫ: ${records.join(' · ')}`,
} as const;

/**
 * Codex copy of the synergy tab and of the mastery section.
 *
 * The tab is named after its content: it shows the critical mutations, and a
 * critical mutation is the synergy of two compatible branches. A locked synergy
 * names its own recipe instead of repeating "not open" three times.
 */
export const CODEX_COPY = {
  /** The number of records the codex counts. */
  recordTotal: 9,
  /** The explanation under the critical mutations header. */
  synergySub: 'Открываются при совмещении двух совместимых ветвей в одном забеге',
  /** The titles of the three locked synergies. */
  synergyTitles: ['ЗАКРЫТАЯ СИНЕРГИЯ I', 'ЗАКРЫТАЯ СИНЕРГИЯ II', 'ЗАКРЫТАЯ СИНЕРГИЯ III'],
  /** The recipe of every locked synergy. */
  synergyRecipes: [
    'БЕЛКОВЫЕ ШИПЫ III + ПРОНИКНОВЕНИЕ II',
    'КАПСИДНЫЕ СПУТНИКИ III + ПОДВИЖНОСТЬ/РЕПЛИКАЦИЯ II',
    'МЕМБРАННЫЙ ИМПУЛЬС III + РНК-АФФИНИТЕТ II',
  ],
  /** The state of a branch that is fully discovered. */
  branchComplete: 'Выполнено',
} as const;

/**
 * One row of the "ПРОХОЖДЕНИЕ РЕЖИМОВ" section.
 *
 * A mode that was never played has no best time, and the row says so with
 * words: an em dash is never used as "no value".
 */
export function masteryModeLine(
  name: string,
  clears: number,
  bestTime: string | null
): string {
  if (clears > 0) return `◆ ${name} — пройдено: ${clears} · рекорд: ${bestTime ?? '—'}`;
  if (bestTime) return `${name} — ещё не пройдена · лучшее время: ${bestTime}`;
  return `${name} — ещё не пройдена`;
}

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
  /** The run is the first run of this player. */
  firstRun?: boolean;
  /** The name of the legendary mutation the run unlocked, if any. */
  legendaryName?: string | null;
  /** Optional trailing block, e.g. the daily streak summary. */
  suffix?: string;
}

/** The title every share text starts with. */
const SHARE_TITLE = 'OFELIYA · Вызов в кровотоке';

/**
 * The share text of a finished run.
 *
 * The three canonical variants of the source of truth are reproduced as they
 * are written there:
 *
 *  - `standard_challenge` — the defeat: the virus "продержался", never "выжил";
 *  - `first_run_challenge` — the first run of the player;
 *  - `legendary_challenge` — a strong run that opened a legendary mutation.
 *
 * A victory that is neither a first run nor a legendary run has no canonical
 * variant, so it uses the victory wording in the same structure: the product
 * shares a victory from the result screen and the text must not describe a
 * victory as a survival.
 *
 * The text leaves the game, so it never names the strain, never names the build
 * profile, never claims a ranking status and never promises the same seed.
 */
export function buildShareText(input: ShareCopyInput): string {
  const kills = fmtInt(input.kills);
  const infected = fmtInt(input.infected);
  const stats = `Уничтожено ${kills} иммунных клеток, заражено ${infected}.`;
  let body: string;
  if (!input.win) {
    // A defeat is a survival that ended, never a "выжил".
    body =
      `🦠 Мой вирус продержался ${input.time} в OFELIYA — и это только начало.\n` +
      `${stats}\n` +
      `Сможешь дольше? Играй: ${SHARE_BOT_HANDLE}`;
  } else if (input.firstRun) {
    body =
      '🦠 Я запустил свой первый штамм в OFELIYA. Синтетический вирус против иммунной системы — выживи дольше меня.\n' +
      `${SHARE_BOT_HANDLE}`;
  } else if (input.legendaryName) {
    body =
      `🦠 ${input.time} выживания в OFELIYA. ${stats}\n` +
      `Легендарная мутация «${input.legendaryName}» открыта.\n` +
      `Повторишь? ${SHARE_BOT_HANDLE}`;
  } else {
    body =
      `🦠 Мой вирус продержался ${input.time} в OFELIYA — и заразил хозяина.\n` +
      `${stats}\n` +
      `Сможешь быстрее? Играй: ${SHARE_BOT_HANDLE}`;
  }
  const suffix = input.suffix ? `\n\n${input.suffix}` : '';
  return `${SHARE_TITLE}\n${body}${suffix}`;
}

/** The share text of a created fixed-seed duel. */
export function buildDuelShareText(targetTime: string): string {
  return `OFELIYA · ДУЭЛЬ: мой результат ${targetTime}. Сможешь пройти быстрее? ${SHARE_BOT_HANDLE}`;
}