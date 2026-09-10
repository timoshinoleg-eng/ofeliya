/**
 * Виральный шаринг результата: читаемая карточка (текст + эмодзи) и deep link.
 *
 * Каналы (по приоритету):
 *  1. Нативный мост мессенджера (MAX shareContent / Telegram shareMessage);
 *  2. Web Share API (браузер/мобильный браузер);
 *  3. Clipboard (fallback — «скопировано»).
 *
 * Deep link: если в SHARE задан username бота (maxBot/tgBot) — строится
 * startapp-ссылка с кратким payload (режим, дата daily, киллы, победа).
 * Иначе — ссылка на размещённый мини-апп (текущий origin+path).
 */
import { fmtTime } from './config';
import { EVOLUTION_NAMES, type EvolutionId } from './UpgradeSystem';
import { MessengerBridge } from '../systems/MessengerBridge';

/** Заполнить username ботов перед публикацией (см. README «Публикация»). */
export const SHARE = {
  maxBot: '',
  tgBot: '',
} as const;

export interface ShareInput {
  win: boolean;
  timeMs: number;
  kills: number;
  level: number;
  evolutions: EvolutionId[];
  daily: boolean;
  dateKey: string;
  records: { timeRecord: boolean; killsRecord: boolean; levelRecord: boolean };
}

export function buildShareText(inp: ShareInput): string {
  const t = fmtTime(inp.timeMs);
  const lines: string[] = [];
  lines.push(
    inp.win
      ? '⚡️ OFELIYA — ЯДРО СТАБИЛИЗИРОВАНО'
      : '💔 OFELIYA — ЯДРО ПОТЕРЯНО'
  );
  lines.push(`⏱ ${t} · 💀 ${inp.kills} · ⬆ ядро ${inp.level}`);
  if (inp.evolutions.length > 0) {
    lines.push(`🧬 ${inp.evolutions.map((id) => EVOLUTION_NAMES[id]).join(' · ')}`);
  }
  const rec: string[] = [];
  if (inp.records.timeRecord && inp.timeMs > 0) rec.push(inp.win ? 'победа' : 'выживание');
  if (inp.records.killsRecord) rec.push('очки');
  if (inp.records.levelRecord) rec.push('ядро');
  if (rec.length > 0) lines.push(`🏆 новый рекорд: ${rec.join(', ')}`);
  if (inp.daily) lines.push(`📅 ежедневное ${inp.dateKey.slice(5).replace('-', '.')}`);
  lines.push(inp.win ? 'Сможешь быстрее?' : 'Сможешь больше?');
  return lines.join('\n');
}

export function buildShareLink(inp: ShareInput): string | undefined {
  const kind = MessengerBridge.kind;
  // payload: режим + (daily: дата) + киллы + флаг победы
  const payload =
    `${inp.daily ? 'd' : 'r'}_${inp.daily ? inp.dateKey.replace(/-/g, '') : 'run'}_${inp.kills}${inp.win ? 'w' : ''}`;
  if (kind === 'max' && SHARE.maxBot) {
    return `https://max.ru/${SHARE.maxBot}?startapp=${payload}`;
  }
  if (kind === 'telegram' && SHARE.tgBot) {
    return `https://t.me/${SHARE.tgBot}?startapp=${payload}`;
  }
  if (typeof location !== 'undefined' && location.origin.startsWith('http')) {
    // VK (web) и обычный браузер: deep link — query-параметр на странице игры.
    if (kind === 'vk') {
      return `${location.origin}${location.pathname}?startapp=${encodeURIComponent(payload)}`;
    }
    return location.origin + location.pathname;
  }
  return undefined;
}

/**
 * Реферальная ссылка (V1): открывает игру со startapp-параметром `ref_<uid>`.
 * Новый игрок получает бонус на первый забег; рёбро фиксируется на сервере.
 */
export function buildRefLink(uid: string): string | undefined {
  const param = `ref_${uid}`;
  const kind = MessengerBridge.kind;
  if (kind === 'max' && SHARE.maxBot) {
    return `https://max.ru/${SHARE.maxBot}?startapp=${param}`;
  }
  if (kind === 'telegram' && SHARE.tgBot) {
    return `https://t.me/${SHARE.tgBot}?startapp=${param}`;
  }
  if (typeof location !== 'undefined' && location.origin.startsWith('http')) {
    return `${location.origin}${location.pathname}?ref=${uid}`;
  }
  return undefined;
}

export type ShareOutcome = 'native' | 'web' | 'clipboard' | 'failed';

export async function shareCard(text: string, link?: string): Promise<ShareOutcome> {
  const full = link ? `${text}\n${link}` : text;
  // 1. Нативный шеринг мессенджера.
  try {
    if (await MessengerBridge.shareResult(full, link)) return 'native';
  } catch {
    /* переходим к fallback */
  }
  // 2. Web Share API (iOS Safari, Android Chrome).
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ text: full, url: link });
      return 'web';
    } catch {
      /* пользователь отменил или API недоступен — clipboard ниже */
    }
  }
  // 3. Clipboard.
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(full);
      return 'clipboard';
    } catch {
      /* приватный режим и т.п. */
    }
  }
  return 'failed';
}
