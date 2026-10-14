import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TelegramUserRegistry } from './telegram-users.mjs';

const directory = mkdtempSync(join(tmpdir(), 'ofeliya-users-'));
const start = { message: { text: '/start ref_42', chat: { id: 777, type: 'private' },
  from: { id: 777, first_name: 'New' } } };
try {
  let mutations = 0;
  const registry = new TelegramUserRegistry(directory, { onChange: () => mutations++ });
  assert.equal(registry.registerPrivateStart(start, 100), true);
  assert.equal(registry.registerPrivateStart(start, 200), false);
  assert.equal(mutations, 1);
  assert.equal(new TelegramUserRegistry(directory).snapshot()['777'].joinedAt, 100);
  const group = { message: { ...start.message, chat: { id: -1, type: 'group' } } };
  assert.equal(registry.registerPrivateStart(group), false);
  assert.equal(registry.registerPrivateStart({ message: { ...start.message, text: '/help' } }), false);
  const broken = new TelegramUserRegistry(directory, { onChange: () => { throw new Error('must not mark'); },
    write: () => { throw new Error('disk unavailable'); } });
  assert.throws(() => broken.registerPrivateStart({ message: { ...start.message,
    from: { id: 778, first_name: 'Lost' } } }), /disk unavailable/);
  assert.equal(broken.snapshot()['778'], undefined);
  assert.deepEqual(broken.health(), { healthy: false });
  let failWrites = true;
  const recovering = new TelegramUserRegistry(directory, {
    write: (...args) => {
      if (failWrites) throw new Error('disk unavailable');
      return writeFileSync(args[0], JSON.stringify(args[1]));
    },
  });
  assert.throws(() => recovering.registerPrivateStart({ message: { ...start.message,
    from: { id: 779, first_name: 'Retry' } } }), /disk unavailable/);
  assert.deepEqual(recovering.health(), { healthy: false });
  failWrites = false;
  assert.equal(recovering.registerPrivateStart({ message: { ...start.message,
    from: { id: 779, first_name: 'Retry' } } }), true);
  assert.deepEqual(recovering.health(), { healthy: true });
  writeFileSync(join(directory, 'tg_users.json'), '{');
  assert.throws(() => new TelegramUserRegistry(directory), /invalid/);
} finally { rmSync(directory, { recursive: true, force: true }); }
console.log('Telegram registry: private registration, idempotency, restart and disk failure passed');
