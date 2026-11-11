/**
 * Run result — the nearest goal.
 *
 * The result screen names what the next run is for. The goal is computed once,
 * in GameScene.finish, from the post-run state, and stored in RunResult: a
 * re-show reuses it and never recomputes it. The rule is the one of
 * `ofeliya-next-goal-contract-2026-11-09.md`, ported from the prototype's
 * `computeGoal` (not from the takeaway's older `target - progress` form: a
 * remainder must never be compared across goals with different units).
 *
 * Categories, strictly in this order:
 *  1. Rotation quests that are not lifetime-scoped and not complete: the
 *     closest to completion (max progress/target; tie — rotation order).
 *     Shown as «Следующий забег: <desc>» + the progress line: «В этом
 *     забеге: <p> / <t>» for run-scoped quests, «Лучшее сегодня: <p> / <t>»
 *     for day-scoped ones (`q_nodmg` counts the day's best across every
 *     run of the day, so the run label would lie after a weaker second
 *     run). No «осталось»: the progress does not carry over to the next run
 *     (for a day-scoped quest it carries over within the day, not the run).
 *  2. Cumulative goals — milestones first (catalog order), then cumulative
 *     quests, but only the ones in today's rotation: max progress/threshold;
 *     tie — catalog order. «Осталось N» is honest here: the progress carries
 *     over (save counters; `marathon`/`veteran` count lifetime runs).
 *  3. Mastery: the run branch's next goal, or the open branch with the
 *     least progress (tie — branch id). A completed branch is never named:
 *     `nextMasteryGoal`'s «Ветка освоена» is a Codex status, not a goal.
 *  4. Nothing fits: the neutral line.
 *
 * Inputs are plain data, so the rule is testable in Node without the game:
 * the quest snapshot entries (the same numbers the QuestBoard shows),
 * the milestone progress list (from MetaAchievements, the single source of
 * truth for thresholds — never a second table), and the mastery tracks
 * (from RunIdentity). The quest catalog is the only runtime import besides
 * copy and formatting: it supplies the description and the metric scope.
 */
import { QUEST_CATALOG, QUEST_METRIC_SCOPES } from '../quests/questCatalog';
import type { QuestMetric, QuestProgress } from '../quests/questTypes';
import type { MetaMilestoneProgress } from './achievements/MetaAchievements';
import type { MasteryTrack, RunIdentityId } from './RunIdentity';
import { GOAL_COPY } from './UiCopy';
import { fmtInt, fmtProgress } from './UiFormat';
import { fmtTime } from './config';

export type NearestGoalCategory = 'quest-run' | 'milestone' | 'quest-cum' | 'mastery' | 'none';

/**
 * The nearest goal, as stored in RunResult and rendered on the result screen.
 * `line1`/`line2` are the exact two lines the result screen shows; the
 * renderer does not compose them.
 */
export interface NearestGoal {
  category: NearestGoalCategory;
  /** Quest id, milestone id, or mastery branch id; null for the neutral line. */
  id: string | null;
  /** Quest title, milestone title, or branch label; null for the neutral line. */
  title: string | null;
  line1: string;
  line2: string;
}

export interface NextGoalInput {
  /** The quest snapshot's progress entries, in rotation (selection) order. */
  questProgress: readonly QuestProgress[];
  /**
   * Milestone progress, in catalog order (the order `metaMilestoneProgress`
   * returns). `progress` is capped at `threshold` by the producer.
   */
  milestones: readonly MetaMilestoneProgress[];
  mastery: {
    identityId: RunIdentityId;
    tracks: readonly MasteryTrack[];
  };
}

/** Metrics measured in seconds: shown as MM:SS, not as a bare count. */
const TIME_METRICS: ReadonlySet<QuestMetric> = new Set(['q_time', 'q_nodmg']);

function formatQuestValue(metric: QuestMetric, value: number): string {
  return TIME_METRICS.has(metric) ? fmtTime(value * 1000) : fmtInt(value);
}

function questById(id: string) {
  return QUEST_CATALOG.find((definition) => definition.id === id);
}

/**
 * Strip the Codex-context prefix from a mastery next goal.
 *
 * The game's `nextGoal` strings read «дальше: Гипершип»: on the Codex that
 * prefix says where the goal leads. On the result screen the header already
 * says «Ближайшая цель», so «Ближайшая цель: дальше: Гипершип» would stutter.
 * A goal without the prefix is used as-is.
 */
function stripFurtherPrefix(nextGoal: string): string {
  return nextGoal.replace(/^дальше: /, '');
}

export function computeNextGoal(input: NextGoalInput): NearestGoal {
  // 1) Rotation quests that are not lifetime-scoped, incomplete, closest first.
  let bestRun: { definition: (typeof QUEST_CATALOG)[number]; progress: number; ratio: number } | null = null;
  for (const entry of input.questProgress) {
    const definition = questById(entry.questId);
    if (!definition) continue;
    if (QUEST_METRIC_SCOPES[definition.metric] === 'lifetime') continue;
    if (entry.complete || entry.progress >= definition.target) continue;
    if (definition.target <= 0) continue;
    const ratio = entry.progress / definition.target;
    if (!bestRun || ratio > bestRun.ratio) bestRun = { definition, progress: entry.progress, ratio };
  }
  if (bestRun) {
    const { definition, progress } = bestRun;
    // A day-scoped quest counts the day's best across every run of the day,
    // so the label says whose best the number is; a run-scoped quest counts
    // this run only.
    const progressPrefix =
      QUEST_METRIC_SCOPES[definition.metric] === 'day'
        ? GOAL_COPY.bestTodayPrefix
        : GOAL_COPY.thisRunPrefix;
    return {
      category: 'quest-run',
      id: definition.id,
      title: definition.title,
      line1: `${GOAL_COPY.nextRunPrefix}${definition.desc}`,
      line2: `${progressPrefix}${formatQuestValue(definition.metric, progress)} / ${formatQuestValue(definition.metric, definition.target)}`,
    };
  }

  // 2) Cumulative goals: milestones first, then cumulative quests in rotation.
  // Milestones are checked in catalog order; the comparison is strict, so a
  // tie keeps the earlier (milestone) candidate.
  let bestCum:
    | { kind: 'milestone'; title: string; desc: string; id: string; progress: number; threshold: number; ratio: number }
    | { kind: 'quest-cum'; title: string; desc: string; id: string; progress: number; threshold: number; ratio: number }
    | null = null;
  for (const milestone of input.milestones) {
    if (milestone.progress >= milestone.threshold) continue;
    if (milestone.threshold <= 0) continue;
    const ratio = milestone.progress / milestone.threshold;
    if (!bestCum || ratio > bestCum.ratio) {
      bestCum = {
        kind: 'milestone',
        title: milestone.title,
        desc: milestone.desc,
        id: milestone.id,
        progress: milestone.progress,
        threshold: milestone.threshold,
        ratio,
      };
    }
  }
  // Cumulative quests come from the catalog (catalog order), looking each up
  // in the snapshot: a quest outside today's rotation is not in the snapshot
  // and can never be proposed.
  const snapshotById = new Map(input.questProgress.map((entry) => [entry.questId, entry]));
  for (const definition of QUEST_CATALOG) {
    if (QUEST_METRIC_SCOPES[definition.metric] !== 'lifetime') continue;
    const entry = snapshotById.get(definition.id);
    if (!entry) continue;
    if (entry.complete || entry.progress >= definition.target) continue;
    if (definition.target <= 0) continue;
    const ratio = entry.progress / definition.target;
    if (!bestCum || ratio > bestCum.ratio) {
      bestCum = {
        kind: 'quest-cum',
        title: definition.title,
        desc: definition.desc,
        id: definition.id,
        progress: entry.progress,
        threshold: definition.target,
        ratio,
      };
    }
  }
  if (bestCum) {
    return {
      category: bestCum.kind,
      id: bestCum.id,
      title: bestCum.title,
      line1: `${bestCum.title} — ${fmtProgress(bestCum.progress, bestCum.threshold)}, ${GOAL_COPY.remainingPrefix}${fmtInt(bestCum.threshold - bestCum.progress)}`,
      line2: bestCum.desc,
    };
  }

  // 3) Mastery: the run branch when it is open, else the open branch with
  // the least progress (tie — branch id, the same rule as nextMasteryGoal).
  const open = input.mastery.tracks.filter((track) => !track.complete);
  let track: MasteryTrack | undefined;
  if (input.mastery.identityId !== 'hybrid') {
    track = open.find((candidate) => candidate.id === input.mastery.identityId);
  }
  if (!track) {
    track = [...open].sort((a, b) => a.progress - b.progress || a.id.localeCompare(b.id))[0];
  }
  if (track) {
    return {
      category: 'mastery',
      id: track.id,
      title: track.label,
      line1: `${GOAL_COPY.closestPrefix}${stripFurtherPrefix(track.nextGoal)}`,
      line2: GOAL_COPY.masteryLine(track.label, track.progress, track.objective),
    };
  }

  // 4) Nothing fits.
  return {
    category: 'none',
    id: null,
    title: null,
    line1: `${GOAL_COPY.closestPrefix}${GOAL_COPY.doneToday}`,
    line2: GOAL_COPY.noGoalDetail,
  };
}
