/**
 * Pure mapping math for the OFELIYA C+ v4 audio beds.
 *
 * HARD CONTRACT: this module stays pure — no Phaser, no WebAudio, no DOM
 * access at import time, no gameplay RNG, no timers. It is compiled and
 * unit-tested in plain Node, exactly like `adaptiveAudioMath.ts`.
 *
 * Why a separate module at all: the production adaptive system
 * (`AdaptiveAudioDirector` + `adaptiveAudioMath`) already owns the act
 * structure, the danger-driven tension filter, the ducking, the procedural
 * bio pulse and the deterministic bed choice. Rewriting it to add boss music
 * would risk the running game for no benefit. Instead the C+ beds are an
 * *alternative bed set* behind an explicit opt-in, described here as data:
 * which bed belongs to which act, which bed belongs to which boss, and how a
 * switch is planned.
 *
 * Mapping rules (the ones the brief asks for explicitly):
 *
 *  1. Bloodstream compositions are only ever used for act I, Heart
 *     compositions only for act II. The two pools are disjoint by
 *     construction, so a Heart bed can never appear in act I.
 *  2. A boss bed replaces the act bed only while that boss is alive; the act
 *     bed returns on the stage transition.
 *  3. The run-end stinger is one-shot and never becomes a loop bed.
 */

/** Bed roles shipped by the C+ v4 package. */
export type CPlusBedRole =
  | 'bloodstream'
  | 'heart'
  | 'immune-prime'
  | 'cardiac-titan'
  | 'victory'
  | 'defeat';

/** Every role maps to exactly one C+ composition. */
export const CPLUS_BED_ROLES: readonly CPlusBedRole[] = [
  'bloodstream',
  'heart',
  'immune-prime',
  'cardiac-titan',
  'victory',
  'defeat',
];

/**
 * Candidate files per role, in load order.
 *
 * OGG Vorbis is listed first because it is gapless, which is what makes the
 * 80 s bed loop without a seam. MP3 is the fallback: Safari / iOS WebView
 * cannot decode Ogg Vorbis at all, so a bed that only ships as OGG would be
 * silent on iOS.
 */
export const CPLUS_BED_SOURCES: Record<CPlusBedRole, readonly string[]> = {
  bloodstream: ['audio/cplus-v4/bloodstream.ogg', 'audio/cplus-v4/bloodstream.mp3'],
  heart: ['audio/cplus-v4/heart.ogg', 'audio/cplus-v4/heart.mp3'],
  'immune-prime': ['audio/cplus-v4/immune_prime.ogg', 'audio/cplus-v4/immune_prime.mp3'],
  'cardiac-titan': ['audio/cplus-v4/cardiac_titan.ogg', 'audio/cplus-v4/cardiac_titan.mp3'],
  victory: ['audio/cplus-v4/victory.ogg', 'audio/cplus-v4/victory.mp3'],
  defeat: ['audio/cplus-v4/defeat.ogg', 'audio/cplus-v4/defeat.mp3'],
};

/** Act pools — disjoint on purpose (rule 1 above). */
export const CPLUS_BED_POOLS = {
  bloodstream: ['bloodstream'] as const,
  heart: ['heart'] as const,
} as const;

/** Boss bed per campaign stage id. */
export const CPLUS_BOSS_BY_STAGE: Record<string, CPlusBedRole> = {
  bloodstream: 'immune-prime',
  heart: 'cardiac-titan',
};

/** Music state of the C+ system. */
export type CPlusMusicState =
  | 'bloodstream'
  | 'heart'
  | 'immune-prime'
  | 'cardiac-titan'
  | 'ended';

/** Why a bed switch was requested. */
export type CPlusBedReason = 'run-start' | 'act-change' | 'boss-spawn' | 'boss-clear' | 'run-end';

export interface CPlusBedPlan {
  /** Bed that should be playing after the switch. */
  readonly role: CPlusBedRole;
  /** Reason the switch was requested. */
  readonly reason: CPlusBedReason;
  /** Crossfade length in milliseconds. */
  readonly fadeMs: number;
  /** One-shot stingers are not looped. */
  readonly loop: boolean;
}

/** Crossfade used between two C+ beds. */
export const CPLUS_BED_FADE_MS = 700;

/** Run-end stingers: one-shot, never looped. */
export const CPLUS_STINGER_ROLES: readonly CPlusBedRole[] = ['victory', 'defeat'];

/** Bed for an act. Act 1 is Bloodstream, act 2 and later is Heart. */
export function cPlusBedForStage(stageOrder: number): CPlusBedRole {
  return stageOrder >= 2 ? 'heart' : 'bloodstream';
}

/** Boss bed for a stage id, or null when the stage has no boss music. */
export function cPlusBedForBoss(stageId: string): CPlusBedRole | null {
  return CPLUS_BOSS_BY_STAGE[stageId] ?? null;
}

/** Run-end stinger for the result. */
export function cPlusStingerForResult(win: boolean): CPlusBedRole {
  return win ? 'victory' : 'defeat';
}

/** True when the role is a one-shot stinger rather than a loop bed. */
export function isCPlusStinger(role: CPlusBedRole): boolean {
  return CPLUS_STINGER_ROLES.indexOf(role) !== -1;
}

/**
 * Decide whether a bed switch is needed.
 *
 * Returns `null` when the bed must stay where it is — that keeps a repeated
 * boss-spawn event from restarting the bed, which would be audible as a
 * stutter in a long fight.
 */
export function planCPlusBed(
  current: CPlusBedRole | null,
  event:
    | { readonly kind: 'run-start'; readonly stageOrder: number }
    | { readonly kind: 'act-change'; readonly stageOrder: number }
    | { readonly kind: 'boss-spawn'; readonly stageId: string }
    | { readonly kind: 'boss-clear'; readonly stageOrder: number }
    | { readonly kind: 'run-end'; readonly win: boolean }
): CPlusBedPlan | null {
  switch (event.kind) {
    case 'run-start': {
      const role = cPlusBedForStage(event.stageOrder);
      return { role, reason: 'run-start', fadeMs: 0, loop: !isCPlusStinger(role) };
    }
    case 'act-change': {
      const role = cPlusBedForStage(event.stageOrder);
      if (current === role) return null;
      return { role, reason: 'act-change', fadeMs: CPLUS_BED_FADE_MS, loop: !isCPlusStinger(role) };
    }
    case 'boss-spawn': {
      const role = cPlusBedForBoss(event.stageId);
      if (!role) return null;
      if (current === role) return null;
      return { role, reason: 'boss-spawn', fadeMs: CPLUS_BED_FADE_MS, loop: !isCPlusStinger(role) };
    }
    case 'boss-clear': {
      const role = cPlusBedForStage(event.stageOrder);
      if (current === role) return null;
      return { role, reason: 'boss-clear', fadeMs: CPLUS_BED_FADE_MS, loop: !isCPlusStinger(role) };
    }
    case 'run-end': {
      const role = cPlusStingerForResult(event.win);
      return { role, reason: 'run-end', fadeMs: 0, loop: false };
    }
    default:
      return null;
  }
}

/**
 * Music state after an event — used by the tests and by the debug overlay.
 * The stinger is one-shot, so the state returns to the act bed right after.
 */
export function cPlusStateAfter(
  state: CPlusMusicState,
  event:
    | { readonly kind: 'run-start'; readonly stageOrder: number }
    | { readonly kind: 'act-change'; readonly stageOrder: number }
    | { readonly kind: 'boss-spawn'; readonly stageId: string }
    | { readonly kind: 'boss-clear'; readonly stageOrder: number }
    | { readonly kind: 'run-end'; readonly win: boolean }
): CPlusMusicState {
  switch (event.kind) {
    case 'run-start':
    case 'act-change':
    case 'boss-clear':
      return cPlusBedForStage(event.stageOrder) as CPlusMusicState;
    case 'boss-spawn': {
      const role = cPlusBedForBoss(event.stageId);
      return (role ?? state) as CPlusMusicState;
    }
    case 'run-end':
      return 'ended';
    default:
      return state;
  }
}

/** Query-parameter flag that turns the C+ beds on for a QA session. */
export const CPLUS_QUERY_FLAG = 'audio=cplus';

/**
 * Whether the C+ beds are enabled for this session.
 *
 * Opt-in only: production keeps the licensed CC0 beds unless the URL asks
 * for the C+ set explicitly (`?audio=cplus`) or a QA session stored the
 * override in local storage.
 */
export function cPlusEnabled(
  search: string | undefined = typeof location !== 'undefined' ? location.search : undefined,
  stored: string | null = typeof localStorage !== 'undefined' ? localStorage.getItem('ofeliya.audio.cplus') : null
): boolean {
  if (stored === '1') return true;
  if (!search) return false;
  const params = new URLSearchParams(search);
  return params.get('audio') === 'cplus' || params.get('cplus') === '1';
}
