import type { QuestStorage } from './questTypes';

/**
 * Browser storage adapter for the quest core.
 *
 * The adapter lives in its own module so the quest core itself stays free of any browser
 * global and can be unit tested in a plain Node process.
 *
 * The key is the one of the Muse reference, `ofeliya.quests.v1`. Two things follow from
 * that:
 *
 * - The record is a separate file that can never shadow, migrate or corrupt the product
 *   save `ofeliya_save_v1`.
 * - A future server migration can find the record at the key the server economy design
 *   expects, so the daily state can be mapped onto `user:{id}:quests` without a second
 *   key to keep in sync.
 *
 * The `.v1` in the key is the storage family of the Muse reference and is kept as is.
 * The authoritative format version lives in the `version` field of the record itself, so
 * a record written by this build is read through the migration path even though the key
 * still says `v1`.
 */
export const QUEST_STORAGE_KEY = 'ofeliya.quests.v1';

/**
 * Creates a storage adapter over `localStorage`.
 *
 * A storage that throws is tolerated: the engine falls back to in-memory state rather
 * than taking the game down with it.
 */
export function createQuestLocalStorage(key: string = QUEST_STORAGE_KEY): QuestStorage {
  return {
    read(): string | null {
      try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(raw: string): void {
      try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(key, raw);
      } catch {
        // A restricted WebView can refuse writes. The quest core keeps working in memory.
      }
    },
  };
}
