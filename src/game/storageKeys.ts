/**
 * Реестр ключей localStorage (документация, пост-ревью, патч №11).
 *
 * ПОВЕДЕНИЯ НЕ МЕНЯЕТ: этот модуль никто не импортирует в прод-коде.
 * Его задача — одна точка правды о том, кто владеет каждым ключом,
 * чтобы новый код не затирал чужое состояние и не плодил дубликаты.
 * При добавлении ключа — добавить строку сюда же.
 *
 * Форматы проверены по коду на момент порта №11 (main, партия 4а).
 * Ключи с суффиксом .v1 — версионированные JSON-объекты; смена схемы
 * требует нового суффикса и миграции, а не тихого переписывания.
 */

export interface StorageKeyInfo {
  /** Кто владеет ключом (модуль). */
  owner: string;
  /** Что лежит внутри (кратко). */
  format: string;
}

export const STORAGE_KEYS: Record<string, StorageKeyInfo> = {
  // Основной сейв забегов (legacy-формат с подчёркиваниями — не переименовывать:
  // старые клиенты читают тот же ключ; см. SaveSystem.ts).
  ofeliya_save_v1: {
    owner: 'src/systems/SaveSystem.ts',
    format: 'JSON: runs, totalKills, bestKills, evolutionsSeen и др. (сейв забегов)',
  },
  // Мета-кошелёк: баланс РНК, счётчики, boosterUntilMs.
  'ofeliya.meta.v1': {
    owner: 'src/game/meta/MetaWallet.ts',
    format: 'JSON: rna, rnaEarned, starsSpent, boosterUntilMs и др.',
  },
  // Лаборатория: уровни веток + счётчик престижей.
  'ofeliya.lab.v1': {
    owner: 'src/game/lab/LabState.ts',
    format: 'JSON: { levels: Record<branchId, level>, prestigeCount }',
  },
  // Квесты: прогресс и выполнение.
  'ofeliya.quests.v1': {
    owner: 'src/quests/questStorage.ts',
    format: 'JSON: состояние QuestRuntime (прогресс квестов)',
  },
  // Мета-достижения: разблокированные id.
  'ofeliya.meta-ach.v1': {
    owner: 'src/game/achievements/MetaAchievements.ts',
    format: 'JSON: массив разблокированных achievement id',
  },
  // Коллекция: выбранный скин (тинт) и открытые записи.
  'ofeliya.collection.v1': {
    owner: 'src/game/collection/ClientCollection.ts',
    format: 'JSON: selectedSkinId и др. (см. также ofeliya.skins.v1)',
  },
  // Владение скинами галереи (DiceBear, Фаза 5) + equippedId.
  'ofeliya.skins.v1': {
    owner: 'src/game/skins/SkinOwnership.ts',
    format: 'JSON: owned ids + equippedId (отдельно от inventory-контракта)',
  },
  // Legacy: гранты скинов за достижения (читается SkinOwnership при миграции).
  'ofeliya.ach-skins.v1': {
    owner: 'src/game/skins/SkinOwnership.ts (legacy)',
    format: 'JSON: массив skin id, выданных за достижения (только чтение)',
  },
  // Daily: клеймы забега дня (стрик/награды — UI-обёртка над серверным Daily).
  'ofeliya.daily.v1': {
    owner: 'src/game/daily/DailyCalendar.ts',
    format: 'JSON: клеймы по датам (локальный кэш; сервер — источник правды)',
  },
  // Журнал чеков Stars-покупок для restore() (+ серверный /api/entitlements v2).
  'ofeliya.telegram.entitlements.v1': {
    owner: 'src/game/shop/TelegramStarsPaymentProvider.ts',
    format: 'JSON: массив { productId, receipt, ts }',
  },
  // Pending-журнал: покупки, ждущие серверного подтверждения (патч №12).
  'ofeliya.payments.pending.v1': {
    owner: 'src/game/shop/PaymentLedger.ts',
    format: 'JSON: массив { nonce, productId, stars, createdAt, attempts }',
  },
  // Журнал выданных charge id — идемпотентность выдачи (патч №12).
  'ofeliya.payments.credited.v1': {
    owner: 'src/game/shop/PaymentLedger.ts',
    format: 'JSON: массив chargeId (string[])',
  },
  // Журнал чеков mock-покупок для restore() (только DEV/QA).
  'ofeliya.mock.entitlements.v1': {
    owner: 'src/game/shop/MockPaymentProvider.ts',
    format: 'JSON: массив { productId, receipt, ts }',
  },
  // Профиль производительности (не JSON-объект, а строка tier).
  ofeliya_performance_tier: {
    owner: 'src/systems/PerformanceProfile.ts',
    format: 'строка: выбранный tier производительности (low/medium/high)',
  },
};
