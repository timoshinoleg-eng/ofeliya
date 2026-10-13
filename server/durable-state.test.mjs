import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableState } from './durable-state.mjs';

const directory = mkdtempSync(join(tmpdir(), 'ofeliya-durable-'));
const keptUsers = { '42': { chatId: '42', first: 'Kept', joinedAt: 1 } };
let db = { revision: 0, document: { store: { scores: [] }, profiles: { profiles: {} }, tg_users: keptUsers } };
let fail = false, loseAck = false;
const transport = async (_url, options) => {
  const body = JSON.parse(options.body);
  assert.equal(options.headers.authorization, 'Bearer test-key');
  if (body.op === 'claim') { db.writer = body.writer_id; db.revision++; return Response.json(db); }
  if (fail) return Response.json({}, { status: 503 });
  if (body.writer_id !== db.writer) return Response.json({}, { status: 409 });
  if (db.lastCommit !== body.commit_id) {
    if (body.expected !== db.revision) return Response.json({}, { status: 409 });
    db.document = body.document; db.revision++; db.lastCommit = body.commit_id;
  } else assert.deepEqual(body.document, db.document);
  if (loseAck) { loseAck = false; throw new Error('connection lost after commit'); }
  return Response.json({ revision: db.revision });
};
try {
  const state = new DurableState('https://state.example', 'test-key', transport);
  await state.restore(directory);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'tg_users.json'))), keptUsers);
  let data = { store: { scores: [{ uid: '1' }] }, profiles: { profiles: { one: { migrated: true } } }, tg_users: keptUsers };
  state.mark(); await state.flush(() => data);
  assert.deepEqual(db.document.store, data.store);
  assert.equal(state.health().dirty, false);
  data.store.scores.push({ uid: '2' }); state.mark(); fail = true;
  await assert.rejects(state.flush(() => data));
  assert.equal(state.health().healthy, false);
  assert.equal(db.document.store.scores.length, 1);
  fail = false; loseAck = true;
  await assert.rejects(state.flush(() => data));
  const committedRevision = db.revision;
  await state.flush(() => data); // same commit id resolves an ambiguous timeout
  assert.equal(db.revision, committedRevision);
  assert.equal(state.health().healthy, true);
  data.store.scores.push({ uid: '3' }); state.mark();
  const writes = [state.flush(() => data), state.flush(() => data)];
  await Promise.all(writes);
  assert.equal(db.document.store.scores.length, 3);
  // A registry-only mutation must survive an independent flush and restart.
  data.tg_users = { ...keptUsers, '777': { chatId: '777', first: 'New', joinedAt: 2 } };
  state.mark(); await state.flush(() => data);
  assert.deepEqual(db.document.tg_users, data.tg_users);
  // Lost acknowledgements freeze the exact pending snapshot. A later registration
  // must be sent in a separate commit rather than modifying the retried UUID.
  data.tg_users['778'] = { chatId: '778', first: 'During', joinedAt: 3 };
  state.mark(); loseAck = true;
  await assert.rejects(state.flush(() => data));
  const registryRevision = db.revision;
  data.tg_users['779'] = { chatId: '779', first: 'After', joinedAt: 4 };
  state.mark(); await state.flush(() => data);
  assert.equal(db.revision, registryRevision + 1);
  assert.deepEqual(db.document.tg_users, data.tg_users);
  const newer = new DurableState('https://state.example', 'test-key', transport);
  await newer.restore(directory);
  assert.deepEqual(JSON.parse(readFileSync(join(directory, 'tg_users.json'))), data.tg_users);
  assert.equal(JSON.parse(readFileSync(join(directory, 'store.json'))).scores.length, 3);
  state.mark(); await assert.rejects(state.flush(() => data), /writer conflict/);
  assert.equal(db.document.store.scores.length, 3);
  console.log('Durable state: restore, failure, ambiguous commit, concurrent flush and writer fencing passed');
} finally { rmSync(directory, { recursive: true, force: true }); }
