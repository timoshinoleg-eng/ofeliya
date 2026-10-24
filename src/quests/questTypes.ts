/**
 * OFELIYA — quest core types.
 *
 * A quest is a counter goal measured from the game run. The quest core is deliberately
 * isolated from the Phaser scenes: it consumes a typed event stream and produces a
 * read-only snapshot, so the integration stage can wire it into `GameScene` without
 * touching boss logic, the HUD layout or the server contracts.
 *
 * Three rules shape everything here:
 *
 * 1. The quest core never grants value. It tracks progress and local completion state,
 *    and it can issue a local receipt, but it never grants RNA, Stars, skins, balance or
 *    a server-side reward. The server Daily remains the only authority for daily value,
 *    and the quest core does not read, write or mirror it.
 * 2. The quest core is not a second daily source. There is no quest calendar and no quest
 *    reward schedule; the daily quest set is a rotating selection of goals, not a payout.
 * 3. The quest core never keeps a second copy of a product counter. The lifetime totals
 *    are mirrored from the product save through `syncLifetime`, so the quest screen can
 *    never drift away from `SaveData`.
 *
 * The vocabulary is the Muse reference. The quest ids, the Russian titles and
 * descriptions, the counter names and the targets are the ones of
 * `src/game/quests/content/quests.ink` in the Muse patch stack, so the HUD copy, the
 * analytics event names and the daily selection are the same on both sides. The one
 * thing that is deliberately *not* taken from the Muse reference is its `reward_rna`
 * tag: the reward table belongs to the server (see `QuestRewardGateway`), and the quest
 * core grants nothing.
 */

/** Stable identifier of a quest in the catalog. */
export type QuestId = string;

/**
 * A measurable quantity a quest can be written against.
 *
 * The names are the counter variables of the Muse reference, unchanged:
 *
 *  - `q_kills`   — enemies destroyed in the current run
 *  - `q_rna`     — RNA collected in the current run
 *  - `q_time`    — seconds survived in the current run
 *  - `q_mut`     — mutations chosen in the current run
 *  - `q_elites`  — elite enemies destroyed in the current run
 *  - `q_nodmg`   — the longest run of seconds without damage
 *  - `q_runs`    — runs completed in total (lifetime, mirrored from `SaveData.runs`)
 */
export type QuestMetric =
  | 'q_kills'
  | 'q_rna'
  | 'q_time'
  | 'q_mut'
  | 'q_elites'
  | 'q_nodmg'
  | 'q_runs';

/**
 * The scope a metric is measured in.
 *
 * - `run` — belongs to the run. The counter is reset when a run starts, and the part of
 *   it that was reached before the current UTC day started is the *baseline*: a quest
 *   counts the progress that was made during the current day, so a run that crosses
 *   midnight cannot finish the next day's quest for free.
 * - `day` — belongs to the UTC day. The value is the best result achieved during the
 *   day, across every run of that day. It is used for the counters whose result is a
 *   streak: the longest run of seconds without damage has to have happened *today*, and
 *   the longest streak of yesterday is not a streak of today.
 * - `lifetime` — never reset, and never counted by the quest core. The value is
 *   mirrored from the product save, so there is exactly one source of truth.
 */
export type QuestMetricScope = 'run' | 'day' | 'lifetime';

/** Whether a metric accumulates over its scope or holds the best result reached in it. */
export type QuestMetricMode = 'accumulate' | 'peak';

export interface QuestDefinition {
  readonly id: QuestId;
  /** Player-facing name, exactly as in the Muse reference. */
  readonly title: string;
  /** Player-facing description of the goal, exactly as in the Muse reference. */
  readonly desc: string;
  /** The counter this quest is measured against. */
  readonly metric: QuestMetric;
  /** Value the metric has to reach for the quest to be complete. */
  readonly target: number;
  /**
   * Grouping of the catalog, for the HUD and for the tests. It carries no reward
   * meaning and it does not influence the daily selection.
   */
  readonly family: 'combat' | 'survival' | 'progress' | 'mastery';
}

/**
 * The typed game-event surface the integration stage writes to.
 *
 * The kinds and their payloads mirror the Muse runtime hooks one to one, so the
 * integration is a rename rather than a redesign:
 *
 * | Event | Muse hook | Product call site |
 * | --- | --- | --- |
 * | `run_started` | `onRunStart` | the start of a fresh run |
 * | `run_completed` | `onRunEnd` | next to `SaveSystem.recordRun` |
 * | `enemy_killed` | `onKill(isElite)` | `GameScene.onEnemyDied` |
 * | `rna_collected` | `onRna(value)` | `GameScene.onGemCollected` |
 * | `mutation_chosen` | `onMutation` | `GameScene.chooseUpgrade` |
 * | `run_tick` | `onTick(timeMs, maxNoDamageMs)` | `GameScene.update` |
 *
 * Two deliberate differences to the Muse runtime:
 *
 * - `run_tick.noDamageMs` carries the **current** no-damage streak
 *   (`runState.stage.noDamageMs`), not the run's peak (`runState.run.maxNoDamageMs`).
 *   The peak includes the streak of a previous UTC day, and the goal "60 seconds in a
 *   row without damage" is a fact about a streak, not about a high-water mark. With the
 *   current streak the quest core can tell "a 60 second streak happened today" from
 *   "a 60 second streak happened before midnight".
 * - The `id` of an event is the idempotency key, and it is **required**. The Muse
 *   runtime has no such field; without it a redelivered event would be counted twice.
 *
 * Every event carries a stable `id`. The engine treats the id as the idempotency key, so
 * a redelivered event is ignored instead of counted twice. The id **must** be unique per
 * occurrence, for example `${runId}:enemy_killed:${sequence}`.
 */
export type QuestEventKind =
  | 'run_started'
  | 'run_completed'
  | 'enemy_killed'
  | 'rna_collected'
  | 'mutation_chosen'
  | 'run_tick';

export interface QuestEventBase {
  /** Unique per occurrence. Used as the idempotency key. */
  readonly id: string;
  /**
   * Epoch milliseconds of the occurrence.
   *
   * Informational only: the UTC rotation runs on the injected clock, not on the event
   * timestamp, so a device with a wrong clock cannot move the quest day by replaying
   * old events.
   */
  readonly at: number;
  /** Optional run the event belongs to. */
  readonly runId?: string;
}

export type QuestEvent =
  | (QuestEventBase & { readonly kind: 'run_started' })
  | (QuestEventBase & { readonly kind: 'run_completed' })
  | (QuestEventBase & { readonly kind: 'enemy_killed'; readonly elite?: boolean; readonly enemyKind?: string })
  | (QuestEventBase & { readonly kind: 'rna_collected'; readonly delta: number })
  | (QuestEventBase & { readonly kind: 'mutation_chosen' })
  | (QuestEventBase & {
      readonly kind: 'run_tick';
      /** Milliseconds survived in the current run. */
      /** Run-elapsed milliseconds; equal/older samples are ignored until checkpoint restore/new run. */
      readonly timeMs: number;
      /**
       * Milliseconds survived without taking damage in the current run — the current
       * streak, not the peak of the run.
       */
      readonly noDamageMs: number;
    });

/** A metric reading held by the engine. */
export type QuestMetricValues = Record<QuestMetric, number>;

/**
 * The product totals the quest core mirrors.
 *
 * The quest core never counts these itself. The integration stage passes the value of
 * `SaveData.runs` in, so the quest screen and the product save can never disagree —
 * which is what the earlier "completed runs lag by one" defect was.
 */
export interface QuestLifetimeMirror {
  readonly completedRuns: number;
}

/** Progress of one quest against the active daily set. */
export interface QuestProgress {
  readonly questId: QuestId;
  /**
   * The current value of the counter, in the unit of the counter: the kills of the
   * current run, the longest streak of the day, the mirrored lifetime total.
   */
  readonly value: number;
  /**
   * The progress that counts towards the goal: the part of the value that was reached
   * during the current day. For a run that started today this is the same number as
   * `value`.
   */
  readonly progress: number;
  readonly target: number;
  readonly complete: boolean;
  /** True once the local receipt for this quest has been issued. */
  readonly claimed: boolean;
}

/** A read-only snapshot of the whole quest core, safe to hand to the HUD. */
export interface QuestSnapshot {
  /** UTC day key the active set belongs to, `YYYY-MM-DD`. */
  readonly dayKey: string;
  /** The three active quest ids, in selection order. */
  readonly activeQuestIds: readonly QuestId[];
  readonly progress: readonly QuestProgress[];
  /**
   * The best value each quest reached during the current day.
   *
   * It survives the reset of the run counters by the next run, so the HUD can show how
   * the day went even after the run is over.
   */
  readonly best: Readonly<Record<string, number>>;
  /**
   * Mirrored product totals, never counted by the quest core.
   *
   * The mirror is not persisted, so it is empty until the integration stage applies it
   * from the product save. `synced` says whether it has been applied, so the HUD can
   * hold the number back instead of showing a zero that is not true.
   */
  readonly lifetime: {
    readonly completedRuns: number;
    readonly synced: boolean;
  };
  /** Number of events the engine has processed and accepted. */
  readonly processedEvents: number;
  /** Number of events that were dropped as duplicates. */
  readonly duplicateEvents: number;
}

/**
 * A local receipt for a finished quest.
 *
 * The receipt is local UI state only. `state` is `local_pending` and never
 * `server_confirmed`: the quest core has no authority to grant anything, and a future
 * server check would have to replace the receipt with a server-issued one.
 */
export interface QuestLocalReceipt {
  readonly questId: QuestId;
  readonly dayKey: string;
  readonly issuedAt: number;
  readonly state: 'local_pending';
}

/**
 * Future server-side reward verification.
 *
 * This interface exists so the integration stage has a defined seam, and it follows the
 * shape of the server economy design: the server owns the reward table and the client
 * only announces a completion. The quest core does not implement the gateway and does
 * not simulate it: with no gateway provided, a completed quest stays `local_pending`
 * forever and no value is granted.
 */
export interface QuestRewardGateway {
  verifyQuestCompletion(
    questId: QuestId,
    dayKey: string
  ): Promise<'confirmed' | 'rejected' | 'unavailable'>;
}

/** Minimal persistence seam. The quest core never touches `localStorage` directly. */
export interface QuestStorage {
  read(): string | null;
  write(raw: string): void;
}

/** Clock seam. Injected so the UTC rotation can be tested deterministically. */
export interface QuestClock {
  now(): number;
}
