import { utcDayKey } from './questRotation';
import { QuestEngine } from './questEngine';
import { createQuestLocalStorage } from './questStorage';
import type { QuestClock, QuestEvent, QuestStorage } from './questTypes';

type QuestPayload = {
  [Kind in QuestEvent['kind']]: Omit<Extract<QuestEvent, { kind: Kind }>, 'id' | 'at' | 'runId'>
}[QuestEvent['kind']];

export interface QuestRunCheckpoint {
  id: string;
  kills: number;
  rna: number;
  mutations: number;
  elites: number;
  ended: boolean;
}
export function validQuestCheckpoint(value: unknown): value is QuestRunCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const v = value as QuestRunCheckpoint;
  return typeof v.id === 'string' && /^[a-zA-Z0-9_-]{1,36}$/.test(v.id) &&
    typeof v.ended === 'boolean' && [v.kills,v.rna,v.mutations,v.elites].every(n =>
      Number.isSafeInteger(n) && n >= 0 && n <= 100_000_000);
}

/** Synchronous GameScene producer. No network, reward gateway, timers or listeners. */
export class QuestRuntime {
  private readonly engine: QuestEngine;
  private run: QuestRunCheckpoint | null = null;
  private second = -1;
  private streakSecond = -1;
  private active = false;
  private deliveryId = identity().slice(0, 8);
  constructor(private readonly storage: QuestStorage = createQuestLocalStorage(),
    private readonly clock: QuestClock = { now: () => Date.now() }) {
    let raw: string | null = null;
    try { raw = storage.read(); const saved = JSON.parse(raw ?? 'null');
      if (validQuestCheckpoint(saved?.runtime)) this.run = saved.runtime;
    } catch { /* restricted or damaged local storage */ }
    this.engine = new QuestEngine({ clock, storage: {
      read: () => raw,
      write: data => storage.write(JSON.stringify({ ...JSON.parse(data), runtime: this.run })),
    } });
  }
  begin(completedRuns: number, resume?: QuestRunCheckpoint,
    progress?: { kills: number; timeMs: number; noDamageMs: number; savedAtEpochMs?: number }): void {
    this.second = this.streakSecond = -1;
    if (resume && this.run?.id === resume.id && this.run.ended) {
      this.active = false;
      this.engine.syncLifetime({ completedRuns });
      return;
    }
    // Crypto identity is deliberately outside deterministic gameplay RNG.
    const id = identity();
    this.deliveryId = identity().slice(0, 8);
    this.run = resume ? { ...resume } : { id, kills:0, rna:0, mutations:0, elites:0, ended:false };
    this.active = !this.run.ended;
    if (!progress) this.send({ kind:'run_started' }, 'start');
    else {
      // Legacy checkpoints have no quest counters: start from known product facts only.
      this.run.kills = progress.kills;
      this.engine.restoreRunMetrics({ ...progress, ...this.run });
      this.engine.restoreNoDamageStreak(progress.noDamageMs,
        progress.savedAtEpochMs !== undefined && utcDayKey(progress.savedAtEpochMs) < this.engine.snapshot().dayKey);
      this.tick(progress.timeMs,progress.noDamageMs,true);
    }
    this.engine.syncLifetime({ completedRuns });
    this.flush();
  }
  private send(payload: QuestPayload, suffix: string): void {
    if (!this.active || !this.run) return;
    // A resumed checkpoint opens a new delivery timeline. Reusing discarded
    // timeline IDs would suppress legitimately replayed pickups and mutations.
    const id = suffix === 'completed'
      ? `${this.run.id}:completed`
      : `${this.run.id}:${this.deliveryId}:${suffix}`;
    this.engine.ingest({ ...payload, id, runId: this.run.id, at: this.clock.now() });
  }
  kill(total: number, enemyKind: string, elite: boolean): void {
    if (!this.active || !this.run || total <= this.run.kills) return;
    this.run.kills = total;
    if (elite) this.run.elites++;
    this.send({kind:'enemy_killed',elite,enemyKind},`kill:${total}`);
  }
  rna(delta:number): void {
    if (!this.active || !this.run || !Number.isFinite(delta) || delta <= 0) return;
    this.run.rna += delta;
    this.send({kind:'rna_collected',delta},`rna:${this.run.rna}`);
  }
  mutation(): void {
    if (!this.active || !this.run) return;
    this.run.mutations++;
    this.send({kind:'mutation_chosen'},`mutation:${this.run.mutations}`);
  }
  tick(timeMs:number,noDamageMs:number,force=false): void {
    const second=Math.floor(timeMs/1000), streak=Math.floor(noDamageMs/1000);
    if (!force && second === this.second && streak >= this.streakSecond) return;
    this.second=second; this.streakSecond=streak;
    this.send({kind:'run_tick',timeMs,noDamageMs},`tick:${second}`);
  }
  end(completedRuns:number): void {
    if (!this.active || !this.run) return;
    this.send({kind:'run_completed'},'completed');
    this.run.ended=true; this.active=false;
    this.engine.syncLifetime({completedRuns});
    this.flush();
  }
  checkpoint(): QuestRunCheckpoint | undefined { return this.run ? {...this.run} : undefined; }
  flush(): void { this.engine.flush(); }
  mirrorLifetime(completedRuns: number): void { this.engine.syncLifetime({ completedRuns }); }
  snapshot() { return this.engine.snapshot(); }
  catalog() { return this.engine.getCatalog(); }
}

let identitySerial = 0;
function identity(): string {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch { /* restricted WebView */ }
  return `local_${Date.now()}_${identitySerial++}`;
}
