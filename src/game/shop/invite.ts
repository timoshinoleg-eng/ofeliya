/**
 * Приглашения (монетизация v3, этап 3).
 *
 * Ссылка-приглашение — это обычный Telegram startapp-линк с реферальным
 * пейлоадом `t_<telegramUserId>`:
 * - формат `t_<uid>` — единственный, который принимает сервер
 *   (server/index.mjs parseReferralRef: `^[tmbv]_[A-Za-z0-9-]{1,48}$`;
 *   `ref_<uid>` НЕ подходит — подчёркивание не входит в legacy-charset,
 *   ссылка была бы молча отброшена);
 * - `t` — код платформы Telegram (REF_PLATFORM_CODES: t/m/b/v).
 *
 * Аттрибуция — серверная, из подписанных launch-данных приглашённого
 * (/api/score записывает edge один раз; см. server/index.mjs, referral V2).
 * Ссылка — только транспорт: пригласивший не может подделать чужой uid
 * в свою пользу, потому что сервер сверяет подпись запуска приглашённого.
 *
 * Бонус — ТОЛЬКО внутриигровой (РНК/косметика), никогда Stars: бот не
 * может отправлять Stars пользователю (нет метода в Bot API). На момент
 * v1 бонус пригласившему НЕ начисляется автоматически: сервер уже
 * фиксирует edge один раз (store.refRewards) и шлёт пуш-уведомление
 * пригласившему (notifyReferrer), а выдача РНК-бонуса — отдельный
 * follow-up (см. memory/03_BACKLOG.md). Тексты баннера НЕ обещают
 * бонус, которого нет.
 *
 * Модуль Phaser-free: чистые функции, тестируются в Node.
 */
import { parseTelegramUserId } from './ServerWalletSync';

/** Код платформы Telegram для реферального пейлоада. */
export const INVITE_PLATFORM_CODE = 't';

/**
 * Чистая функция: реферальный пейлоад для startapp-ссылки.
 * null — id невалиден (не положительное безопасное целое).
 */
export function buildInvitePayload(telegramUserId: number): string | null {
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) return null;
  return `${INVITE_PLATFORM_CODE}_${telegramUserId}`;
}

/**
 * Чистая функция: реферальный пейлоад из сырого initData Telegram WebApp.
 * null — initData нет или user.id не распарсить (не Telegram / гость).
 */
export function buildInvitePayloadFromInitData(initData: string): string | null {
  const userId = parseTelegramUserId(initData);
  return userId === null ? null : buildInvitePayload(userId);
}

/** Текст для шаринга приглашения (без обещания бонуса — см. шапку). */
export const INVITE_SHARE_TEXT = 'OFELIYA: STRAIN ZERO — выживи в кровотоке. Играй со мной!';
