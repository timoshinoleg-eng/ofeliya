/**
 * grantPurchase — выдача купленных товаров (порт витрины, main-only).
 *
 * В стеке витрина на этом месте только показывала экран успеха
 * («Сейчас выдача = анимация + запись в провайдере + аналитика», см.
 * ofeliya-storefront-design.md): реальной выдачи не было, она пришла
 * только в post-review-патчах. В main выдача делается сразу, через
 * существующие механизмы наград — иначе экран «Выдано» врал бы:
 *   - kind 'skin'     → SkinOwnership.grantSkin(id, 'purchase');
 *     скины живут в ofeliya.skins.v1 и НЕ попадают в inventory-контракт
 *     (scripts/check-profile-client.mjs:162 запрещает source 'purchase'
 *     только для inventory — этот файл здесь не трогается);
 *   - kind 'currency' → MetaWallet.addRna (наборы ×500/×1500);
 *   - kind 'booster'  → MetaWallet.boosterUntilMs (РНК ×2 на 7 дней;
 *     множитель применяется в GameScene.spawnGem рядом с флагом
 *     events.doubleRna — та же точка, тот же смысл).
 *
 * purchaseGrants — чистая функция (маппинг товар → действия), тестируется
 * в Node. applyPurchaseGrants — рантайм: выполняет действия, никогда не
 * бросает (витрина не падает из-за хранилища).
 */
import { addRna, setBoosterUntilMs } from '../meta/MetaWallet';
import { grantSkin } from '../skins/SkinOwnership';
import type { Product } from './PaymentProvider';

export type PurchaseGrant =
  | { type: 'skin'; skinId: string }
  | { type: 'rna'; amount: number }
  | { type: 'booster'; durationMs: number };

/** Наборы РНК: id товара → количество (из названий каталога). */
const RNA_PACK_AMOUNTS: Record<string, number> = {
  'currency.rna-pack-s': 500,
  'currency.rna-pack-m': 1500,
};

/** Длительность бустера «РНК ×2» — 7 дней (из названия товара). */
export const BOOSTER_DURATION_MS = 7 * 24 * 3600 * 1000;

/**
 * Чистая функция: какие награды даёт товар. Неизвестный id/вид —
 * пустой список (fail-closed: покупка не выдаёт то, чего нет в маппинге).
 */
export function purchaseGrants(product: Product): PurchaseGrant[] {
  if (product.kind === 'skin') return [{ type: 'skin', skinId: product.id }];
  if (product.kind === 'currency') {
    const amount = RNA_PACK_AMOUNTS[product.id];
    return amount !== undefined ? [{ type: 'rna', amount }] : [];
  }
  if (product.kind === 'booster') return [{ type: 'booster', durationMs: BOOSTER_DURATION_MS }];
  return [];
}

/**
 * Рантайм: выдать награды за товар. Возвращает применённые действия.
 * Никогда не бросает.
 */
export function applyPurchaseGrants(product: Product): PurchaseGrant[] {
  const grants = purchaseGrants(product);
  for (const grant of grants) {
    try {
      if (grant.type === 'skin') grantSkin(grant.skinId, 'purchase');
      else if (grant.type === 'rna') addRna(grant.amount);
      else setBoosterUntilMs(Date.now() + grant.durationMs);
    } catch {
      /* выдача не ломает витрину */
    }
  }
  return grants;
}
