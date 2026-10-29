/**
 * SkinOwnership — косметическое владение скинами (Фаза 5).
 *
 * ВАЖНО: это НЕ игровой inventory. Серверный контракт
 * scripts/check-profile-client.mjs:162 программно запрещает inventory
 * с source 'purchase' — скины живут в отдельном хранилище
 * `ofeliya.skins.v1` и никогда не попадают в inventory-контракт.
 *
 * Чистая логика (parse/grant/equip/migrate) — без localStorage,
 * тестируется в Node. Тонкие обёртки load/save/grantSkin/equipSkin —
 * для рантайма.
 *
 * Аналитика (порт): в main нет UmamiAnalytics стека — события skin_granted /
 * skin_equipped идут через trackClientEvent (тот же клиентский воронка-синк,
 * что питает trackProductEvent; без конфигурации — no-op, как umami-клиент
 * стека без websiteId/src).
 */
import { DEFAULT_SKIN_ID, getSkinDef } from './SkinCatalog';
import { trackClientEvent } from '../../systems/ClientExperience';

export const SKINS_STORAGE_KEY = 'ofeliya.skins.v1';
/** Легаси-гранты Фазы 3 (MetaAchievements.grantAchievementSkin) — мигрируют сюда. */
const LEGACY_GRANTS_KEY = 'ofeliya.ach-skins.v1';

export interface SkinStore {
  owned: string[];
  equippedId: string;
}

export type SkinGrantSource = 'achievement' | 'quest' | 'purchase' | 'dev';

/** Чистая функция: пустое хранилище (дефолтный скин — в собственности и экипирован). */
export function emptyStore(): SkinStore {
  return { owned: [DEFAULT_SKIN_ID], equippedId: DEFAULT_SKIN_ID };
}

/** Чистая функция: является ли id известным скином каталога. */
export function isKnownSkin(skinId: string): boolean {
  return getSkinDef(skinId) !== undefined;
}

/**
 * Чистая функция: разобрать сырое хранилище. Мусор/неизвестные id
 * отбрасываются, дефолтный скин гарантирован.
 */
export function parseStore(raw: string | null): SkinStore {
  const store = emptyStore();
  if (!raw) return store;
  try {
    const p = JSON.parse(raw) as Partial<SkinStore>;
    if (Array.isArray(p.owned)) {
      for (const id of p.owned) {
        if (typeof id === 'string' && isKnownSkin(id) && !store.owned.includes(id)) {
          store.owned.push(id);
        }
      }
    }
    if (typeof p.equippedId === 'string' && store.owned.includes(p.equippedId)) {
      store.equippedId = p.equippedId;
    }
  } catch {
    /* ignore — дефолт */
  }
  return store;
}

/** Чистая функция: сериализация. */
export function serializeStore(store: SkinStore): string {
  return JSON.stringify({ owned: store.owned, equippedId: store.equippedId });
}

/** Чистая функция: разобрать легаси-гранты Фазы 3 (известные id, без дублей). */
export function migrateLegacyGrants(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const id of list) {
      if (typeof id === 'string' && isKnownSkin(id) && !out.includes(id)) out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Чистая функция: выдать скин. Возвращает обновлённое хранилище и флаг
 * «выдан впервые». Неизвестные id отклоняются.
 */
export function grantSkinTo(
  store: SkinStore,
  skinId: string
): { store: SkinStore; granted: boolean } {
  if (!isKnownSkin(skinId)) return { store, granted: false };
  if (store.owned.includes(skinId)) return { store, granted: false };
  return { store: { owned: [...store.owned, skinId], equippedId: store.equippedId }, granted: true };
}

/**
 * Чистая функция: экипировать скин. Только из собственности;
 * чужой id — отказ без изменения.
 */
export function equipSkinIn(store: SkinStore, skinId: string): { store: SkinStore; ok: boolean } {
  if (!store.owned.includes(skinId)) return { store, ok: false };
  if (store.equippedId === skinId) return { store, ok: true };
  return { store: { owned: store.owned, equippedId: skinId }, ok: true };
}

// ---------------------------------------------------------------------------
// Рантайм-обёртки (localStorage)
// ---------------------------------------------------------------------------

function readRaw(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Загрузить хранилище (с миграцией легаси-грантов Фазы 3 — один раз). */
export function loadSkinStore(): SkinStore {
  let store = parseStore(readRaw(SKINS_STORAGE_KEY));
  const legacy = migrateLegacyGrants(readRaw(LEGACY_GRANTS_KEY));
  let changed = false;
  for (const id of legacy) {
    const res = grantSkinTo(store, id);
    if (res.granted) {
      store = res.store;
      changed = true;
    }
  }
  if (changed) writeRaw(SKINS_STORAGE_KEY, serializeStore(store));
  return store;
}

function saveSkinStore(store: SkinStore): void {
  writeRaw(SKINS_STORAGE_KEY, serializeStore(store));
}

/**
 * Выдать скин (рантайм). Источник — для аналитики. При первой выдаче —
 * событие skin_granted. Никогда не бросает.
 */
export function grantSkin(skinId: string, source: SkinGrantSource): boolean {
  try {
    const store = loadSkinStore();
    const res = grantSkinTo(store, skinId);
    if (!res.granted) return false;
    saveSkinStore(res.store);
    trackClientEvent('skin_granted', { skinId, source });
    return true;
  } catch {
    return false;
  }
}

/** Экипировать скин (рантайм). При успехе — событие skin_equipped. */
export function equipSkin(skinId: string): boolean {
  try {
    const store = loadSkinStore();
    const res = equipSkinIn(store, skinId);
    if (!res.ok) return false;
    saveSkinStore(res.store);
    if (res.store.equippedId === skinId) {
      trackClientEvent('skin_equipped', { skinId });
    }
    return true;
  } catch {
    return false;
  }
}

/** Экипированный скин (рантайм). */
export function getEquippedSkinId(): string {
  try {
    return loadSkinStore().equippedId;
  } catch {
    return DEFAULT_SKIN_ID;
  }
}

/** В собственности ли скин (рантайм). */
export function isSkinOwned(skinId: string): boolean {
  try {
    return loadSkinStore().owned.includes(skinId);
  } catch {
    return skinId === DEFAULT_SKIN_ID;
  }
}
