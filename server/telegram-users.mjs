import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const record = value => value != null && typeof value === 'object' && !Array.isArray(value);
export function validateTelegramUsers(value) {
  if (!record(value)) throw new Error('Invalid Telegram user registry');
  for (const [uid, user] of Object.entries(value)) {
    if (!/^\d{1,64}$/.test(uid) || !record(user) || !/^\d{1,64}$/.test(String(user.chatId)) ||
        typeof user.first !== 'string' || !Number.isSafeInteger(user.joinedAt) || user.joinedAt < 0) {
      throw new Error('Invalid Telegram user registry');
    }
  }
  return value;
}

function writeUsers(file, users) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  const fd = openSync(temporary, 'w', 0o600);
  try { writeFileSync(fd, JSON.stringify(users)); fsyncSync(fd); }
  finally { closeSync(fd); }
  renameSync(temporary, file);
}

/** The webhook/API process owns registrations. In remote mode this file is only
 * a mirror of the restored snapshot; no mtime merge or concurrent polling writer.
 */
export class TelegramUserRegistry {
  constructor(directory, { onChange = () => {}, write = writeUsers } = {}) {
    this.file = join(directory, 'tg_users.json');
    this.onChange = onChange;
    this.write = write;
    this.persistenceError = false;
    try { this.users = validateTelegramUsers(JSON.parse(readFileSync(this.file, 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Telegram user registry unavailable or invalid');
      this.users = {};
    }
  }
  snapshot() { return JSON.parse(JSON.stringify(this.users)); }
  registerPrivateStart(update, now = Date.now()) {
    const message = update?.message;
    if (message?.chat?.type !== 'private' || typeof message.text !== 'string' ||
        !/^\/start(?:@\w+)?(?:\s|$)/.test(message.text)) return false;
    const uid = String(message.from?.id ?? '');
    const chatId = String(message.chat?.id ?? '');
    if (!/^\d{1,64}$/.test(uid) || !/^\d{1,64}$/.test(chatId) || message.from?.is_bot === true) return false;
    const first = typeof message.from?.first_name === 'string' ? message.from.first_name.slice(0, 64) : 'игрок';
    const previous = this.users[uid];
    if (previous?.chatId === chatId && previous.first === first) return false;
    const next = { ...this.users, [uid]: { chatId, first, joinedAt: previous?.joinedAt ?? now } };
    validateTelegramUsers(next);
    // Fail before publishing/marking a mutation when the local mirror cannot be
    // written. The caller must still await remote persistence before HTTP 200.
    try {
      this.write(this.file, next);
      this.persistenceError = false;
    } catch (error) {
      this.persistenceError = true;
      throw error;
    }
    this.users = next;
    this.onChange();
    return true;
  }
  health() { return { healthy: !this.persistenceError }; }
}
