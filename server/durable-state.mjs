import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateTelegramUsers } from './telegram-users.mjs';

export class DurableState {
  constructor(url, token, request = fetch) {
    if (!url || !token || new URL(url).protocol !== 'https:') throw new Error('Durable state requires HTTPS and a key');
    this.url = url; this.token = token; this.request = request;
    this.writer = randomUUID(); this.revision = null;
    this.generation = 0; this.savedGeneration = 0;
    this.tail = Promise.resolve(); this.pending = null; this.error = null;
  }
  async call(input) {
    const res = await this.request(this.url, {
      method: 'POST', headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(res.status === 409 ? 'Durable state writer conflict' : 'Durable state unavailable');
    const result = await res.json();
    if (!Number.isSafeInteger(result.revision)) throw new Error('Invalid durable state revision');
    return result;
  }
  async restore(directory) {
    const result = await this.call({ op: 'claim', writer_id: this.writer });
    if (!result.document?.store || !result.document?.profiles) throw new Error('Durable state has no initialized snapshot');
    const users = validateTelegramUsers(result.document.tg_users ?? {});
    this.revision = result.revision;
    mkdirSync(directory, { recursive: true });
    for (const name of ['store', 'profiles', 'tg_users']) {
      const value = name === 'tg_users' ? users : result.document[name];
      if (value != null) writeFileSync(join(directory, name + '.json'), JSON.stringify(value));
    }
  }
  mark() { this.generation++; }
  flush(snapshot) {
    const task = async () => {
      try {
        if (this.pending) await this.commitPending();
        if (this.savedGeneration === this.generation) return;
        const document = snapshot();
        // Every writer supplies the registry it owns; never fall back to the
        // startup snapshot or read a competing file during a retry.
        const users = validateTelegramUsers(document.tg_users);
        this.pending = { generation: this.generation, input: {
          op: 'commit', writer_id: this.writer, expected: this.revision, commit_id: randomUUID(),
          document: JSON.parse(JSON.stringify({ ...document, tg_users: users })),
        } };
        await this.commitPending();
      } catch (error) { this.error = error.message; throw error; }
    };
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => {});
    return next;
  }
  async commitPending() {
    const result = await this.call(this.pending.input);
    this.revision = result.revision;
    this.savedGeneration = this.pending.generation;
    this.pending = null; this.error = null;
  }
  health() {
    return { mode: 'remote', healthy: this.error == null, dirty: this.generation !== this.savedGeneration, revision: this.revision };
  }
}
