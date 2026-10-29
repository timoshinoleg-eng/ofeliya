/**
 * StorefrontScene — rail-agnostic витрина (магазин) OFELIYA.
 *
 * Отдельная сцена (а не панель MenuScene/UIScene): у MenuScene/UIScene измеренные
 * layout-контракты (tokens-contract, visible-text-bounds), а у витрины свой
 * жизненный цикл (загрузка → список → покупка → успех) — см.
 * ofeliya-storefront-design.md §6.
 *
 * Гейт флагом storefront.variant: 'hidden' (дефолт) — сцена сразу
 * возвращается в меню; 'mock' — MockPaymentProvider; 'max' — stub
 * MaxBridgePaymentProvider → экран «скоро» (graceful, не краш).
 *
 * Реальных денег нет: покупки идут через PaymentProvider; аналитика воронки —
 * через trackProductEvent (серверный allowlist, как run_10min/mutation_chosen);
 * анимация выдачи — обычные твины сцены (Juice из партии 4 сюда не заводится:
 * витрина не должна зависеть от game-feel движка забега).
 * Выдача — через shop/grantPurchase (скины → SkinOwnership, наборы РНК →
 * MetaWallet, бустер → boosterUntilMs): экран «Выдано» означает выданное.
 */
import Phaser from 'phaser';
import { COLORS, FONT, UI_FONT } from '../game/config';
import { FeatureFlags } from '../game/FeatureFlags';
import { PlatformBridge } from '../platform';
import { trackProductEvent } from '../systems/AnalyticsClient';
import { prefersReducedMotion } from '../systems/MotionPreferences';
import { BORDER, CLAMP, PANEL, ROLE, SPACE, TOUCH } from '../ui/tokens';
import { VISUAL_TEXT } from '../ui/visualTokens';
import { STOREFRONT_MAX, isStorefrontVisible, resolveProvider } from '../game/shop/Storefront';
import { applyPurchaseGrants } from '../game/shop/grantPurchase';
import { formatPrice, validateCatalog } from '../game/shop/products';
import type {
  PaymentProvider,
  Product,
  PurchaseResult,
} from '../game/shop/PaymentProvider';

type SceneState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'purchasing'
  | 'success'
  | 'unavailable';

/** Палитры заглушек арта (до DiceBear-рендера Фазы 5). */
const STUB_PALETTES: Record<string, number> = {
  magenta: 0xff4fb5,
  teal: 0x2fd6c0,
  gold: 0xffd56a,
  green: 0x7fffa1,
  cyan: 0x8fe8ff,
};

/**
 * Детерминированный хеш строки → 0..1. Для заглушки арта: один seed —
 * один узор точек, без ассетов.
 */
export function seedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

export class StorefrontScene extends Phaser.Scene {
  private provider: PaymentProvider | null = null;
  private variant = 'hidden';
  private state: SceneState = 'loading';
  private products: Product[] = [];
  private errorReason = '';
  private purchasingId: string | null = null;
  private lastBought: Product | null = null;

  private root: Phaser.GameObjects.Container | null = null;
  private listContainer: Phaser.GameObjects.Container | null = null;
  private maskGraphics: Phaser.GameObjects.Graphics | null = null;
  private scrollOffset = 0;
  private scrollLimit = 0;
  private scrollOwner = -1;
  private scrollLastY = 0;

  constructor() {
    super({ key: 'Storefront' });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.variant = FeatureFlags.get('storefront.variant');

    // Fail-closed: без видимого варианта витрины тут делать нечего.
    if (!isStorefrontVisible(this.variant)) {
      this.scene.start('Menu');
      return;
    }
    this.provider = resolveProvider(this.variant);

    this.buildChrome();
    void trackProductEvent('store_viewed', PlatformBridge, {
      provider: this.provider ? this.provider.id : 'none',
      variant: this.variant,
    });

    if (!this.provider || !this.provider.isAvailable()) {
      this.setState('unavailable');
      return;
    }
    void this.loadProducts();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.clearListMask();
      this.root?.destroy(true);
      this.root = null;
    });
  }

  // ---------- layout ----------

  private buildChrome(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.root = this.add.container(0, 0).setDepth(10).setName('ofeliya-storefront');

    // Заголовок.
    const title = this.add
      .text(W / 2, 44, 'ВИТРИНА', {
        fontFamily: FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setResolution(2);
    this.root.add(title);

    // Кнопка «назад».
    const backW = 104;
    const backH = Math.max(TOUCH.min, 40);
    const backBg = this.add
      .rectangle(12 + backW / 2, 44, backW, backH, ROLE.surface.panel, PANEL.button)
      .setStrokeStyle(BORDER.thin, ROLE.surface.stroke, 0.8)
      .setInteractive({ useHandCursor: true });
    const backLabel = this.add
      .text(12 + backW / 2, 44, '‹ НАЗАД', {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0.5)
      .setResolution(2);
    backBg.on('pointerdown', () => backBg.setAlpha(0.6));
    backBg.on('pointerup', () => {
      backBg.setAlpha(1);
      this.scene.start('Menu');
    });
    this.root.add([backBg, backLabel]);

    // Подзаголовок-режим (видно, какой рельс активен — важно для QA).
    const modeLabel = this.variant === STOREFRONT_MAX ? 'рельс MAX (заглушка)' : 'тестовый режим · без реальных платежей';
    const mode = this.add
      .text(W / 2, 72, modeLabel, {
        fontFamily: UI_FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0.5)
      .setResolution(2);
    this.root.add(mode);
    void H;
  }

  /** Область контента под шапкой. */
  private contentRect(): { x: number; top: number; width: number; height: number } {
    const W = this.scale.width;
    const H = this.scale.height;
    const width = Math.min(W - CLAMP.padScreen * 2, CLAMP.panelMax);
    const top = 96;
    return { x: W / 2, top, width, height: Math.max(200, H - top - CLAMP.padScreen) };
  }

  // ---------- states ----------

  private setState(state: SceneState): void {
    this.state = state;
    this.renderContent();
  }

  private clearContent(): void {
    this.clearListMask();
    this.listContainer?.destroy(true);
    this.listContainer = null;
    this.scrollOffset = 0;
    this.scrollLimit = 0;
  }

  private renderContent(): void {
    if (!this.root || !this.sys.isActive()) return;
    this.clearContent();
    const { x, top, width, height } = this.contentRect();
    switch (this.state) {
      case 'loading':
        this.renderCenterNote(x, top + height / 2, 'Загрузка витрины…', VISUAL_TEXT.muted);
        break;
      case 'unavailable':
        this.renderSoon(x, top, width, height);
        break;
      case 'empty':
        this.renderCenterNote(x, top + height / 2, 'Пока пусто', VISUAL_TEXT.muted);
        break;
      case 'error':
        this.renderError(x, top, width, height);
        break;
      case 'ready':
      case 'purchasing':
        this.renderList(x, top, width, height);
        break;
      case 'success':
        this.renderList(x, top, width, height);
        this.renderSuccessOverlay();
        break;
    }
  }

  private renderCenterNote(x: number, y: number, text: string, color: string): void {
    if (!this.root) return;
    const note = this.add
      .text(x, y, text, { fontFamily: UI_FONT, fontSize: '14px', color })
      .setOrigin(0.5)
      .setResolution(2)
      .setName('ofeliya-storefront-note');
    this.root.add(note);
  }

  /** Graceful «скоро»: рельс недоступен (MAX сегодня) — не краш, не пусто. */
  private renderSoon(x: number, y: number, width: number, height: number): void {
    if (!this.root) return;
    const panelH = 190;
    const cy = y + height / 2;
    const panel = this.add
      .rectangle(x, cy, width, panelH, ROLE.surface.panel, PANEL.panel)
      .setStrokeStyle(BORDER.medium, ROLE.surface.stroke, 0.9);
    const title = this.add
      .text(x, cy - 52, 'Магазин скоро откроется', {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        align: 'center',
        wordWrap: { width: width - 48 },
      })
      .setOrigin(0.5)
      .setResolution(2);
    const sub = this.add
      .text(x, cy + 6, 'Платёжный рельс MAX пока недоступен.\nСледите за новостями штамма.', {
        fontFamily: UI_FONT,
        fontSize: '12px',
        color: VISUAL_TEXT.muted,
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
    this.root.add([panel, title, sub]);
  }

  private renderError(x: number, y: number, width: number, height: number): void {
    if (!this.root) return;
    const cy = y + height / 2;
    this.renderCenterNote(x, cy - 30, 'Не удалось загрузить витрину', VISUAL_TEXT.danger);
    this.renderCenterNote(x, cy, this.errorReason, VISUAL_TEXT.muted);
    const btnW = 180;
    const btnH = Math.max(TOUCH.min, 44);
    const btn = this.add
      .rectangle(x, cy + 52, btnW, btnH, ROLE.surface.panelHover, PANEL.button)
      .setStrokeStyle(BORDER.thin, ROLE.surface.stroke, 0.9)
      .setInteractive({ useHandCursor: true });
    const label = this.add
      .text(x, cy + 52, 'ПОВТОРИТЬ', {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setOrigin(0.5)
      .setResolution(2);
    btn.on('pointerdown', () => btn.setAlpha(0.6));
    btn.on('pointerup', () => {
      btn.setAlpha(1);
      this.setState('loading');
      void this.loadProducts();
    });
    this.root.add([btn, label]);
  }

  // ---------- product list ----------

  private async loadProducts(): Promise<void> {
    const provider = this.provider;
    if (!provider) {
      this.setState('unavailable');
      return;
    }
    try {
      const products = await provider.listProducts();
      if (!this.sys.isActive()) return;
      const errors = validateCatalog(products);
      if (errors.length > 0) {
        this.errorReason = 'каталог не прошёл валидацию';
        this.setState('error');
        return;
      }
      this.products = products;
      this.setState(products.length === 0 ? 'empty' : 'ready');
    } catch (e) {
      if (!this.sys.isActive()) return;
      this.errorReason = e instanceof Error ? e.message : 'unknown';
      this.setState('error');
    }
  }

  private renderList(x: number, top: number, width: number, height: number): void {
    if (!this.root) return;
    const list = this.add.container(x, top).setName('ofeliya-storefront-list');
    this.root.add(list);
    this.listContainer = list;

    const cardH = 108;
    const gap = SPACE.md;
    let cy = 0;
    for (const product of this.products) {
      this.buildCard(list, product, 0, cy, width, cardH);
      cy += cardH + gap;
    }
    const totalH = Math.max(0, cy - gap);
    this.scrollLimit = Math.max(0, totalH - height);

    // Маска + drag-scroll по паттерну ResultReport (чистая отписка на destroy).
    const clip = this.make.graphics({});
    const a = { x: x - width / 2, y: top };
    clip.fillStyle(0x000000, 1).fillRect(a.x, a.y, width, height);
    const mask = clip.createGeometryMask();
    list.setMask(mask);
    this.maskGraphics = clip;

    const hit = this.add
      .rectangle(x, top + height / 2, width, height, 0x000000, 0)
      .setName('ofeliya-storefront-hit');
    this.root.add(hit);
    if (this.scrollLimit > 0) {
      hit.setInteractive();
      hit.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        this.scrollOwner = pointer.id;
        this.scrollLastY = pointer.y;
      });
      hit.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => {
        this.applyScroll(this.scrollOffset + dy * 0.5);
      });
    }
    const move = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id !== this.scrollOwner || !this.listContainer) return;
      this.applyScroll(this.scrollOffset + (this.scrollLastY - pointer.y));
      this.scrollLastY = pointer.y;
    };
    const release = (pointer: Phaser.Input.Pointer): void => {
      if (pointer.id === this.scrollOwner) this.scrollOwner = -1;
    };
    this.input.on('pointermove', move);
    this.input.on('pointerup', release);
    list.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.input.off('pointermove', move);
      this.input.off('pointerup', release);
    });
    this.applyScroll(0);
  }

  private applyScroll(next: number): void {
    if (!this.listContainer) return;
    const { top } = this.contentRect();
    this.scrollOffset = Phaser.Math.Clamp(next, 0, this.scrollLimit);
    this.listContainer.y = top - this.scrollOffset;
  }

  private clearListMask(): void {
    if (this.listContainer) {
      this.listContainer.clearMask(true);
    }
    this.maskGraphics?.destroy();
    this.maskGraphics = null;
  }

  private buildCard(
    parent: Phaser.GameObjects.Container,
    product: Product,
    cx: number,
    cy: number,
    width: number,
    height: number
  ): void {
    const card = this.add.container(cx, cy);
    const bg = this.add
      .rectangle(0, 0, width, height, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, ROLE.surface.stroke, 0.85)
      .setOrigin(0.5, 0);
    card.add(bg);

    // Арт-заглушка: детерминированный узор по хешу seed (до DiceBear Фазы 5).
    const artColor = STUB_PALETTES[product.art.palette] ?? ROLE.faction.neutral;
    const medallion = this.add.container(-width / 2 + 52, height / 2);
    const disc = this.add.circle(0, 0, 30, artColor, 0.28).setStrokeStyle(2, artColor, 0.9);
    medallion.add(disc);
    const h = seedHash(product.art.seed);
    for (let i = 0; i < 5; i++) {
      const ang = h * Math.PI * 2 + (i * Math.PI * 2) / 5;
      const r = 8 + ((h * 97 + i * 13) % 10);
      medallion.add(this.add.circle(Math.cos(ang) * r, Math.sin(ang) * r, 3.5, artColor, 0.95));
    }
    card.add(medallion);

    const textX = -width / 2 + 96;
    const title = this.add
      .text(textX, 14, product.title, {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setOrigin(0, 0)
      .setResolution(2);
    const desc = this.add
      .text(textX, 38, product.description, {
        fontFamily: UI_FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
        wordWrap: { width: width - textX - width / 2 - 108 },
        lineSpacing: 2,
      })
      .setOrigin(0, 0)
      .setResolution(2);
    card.add([title, desc]);

    if (product.tag) {
      const tag = this.add
        .text(width / 2 - 12, 10, product.tag, {
          fontFamily: FONT,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#0b0f1a',
          backgroundColor: '#ffd56a',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(1, 0)
        .setResolution(2);
      card.add(tag);
    }

    // Кнопка цены.
    const btnW = 96;
    const btnH = Math.max(TOUCH.min, 44);
    const btnX = width / 2 - 12 - btnW / 2;
    const btnY = height - btnH / 2 - 10;
    const buying = this.state === 'purchasing' && this.purchasingId === product.id;
    const btnBg = this.add
      .rectangle(btnX, btnY, btnW, btnH, ROLE.faction.reward, buying ? 0.55 : PANEL.button)
      .setStrokeStyle(BORDER.thin, 0x0b0f1a, 0.6)
      .setInteractive({ useHandCursor: true });
    const btnLabel = this.add
      .text(btnX, btnY, buying ? '···' : formatPrice(product.price), {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#0b0f1a',
      })
      .setOrigin(0.5)
      .setResolution(2);
    if (!buying) {
      btnBg.on('pointerdown', () => btnBg.setAlpha(0.6));
      btnBg.on('pointerup', () => {
        btnBg.setAlpha(1);
        void this.buy(product);
      });
    }
    card.add([btnBg, btnLabel]);
    parent.add(card);
  }

  // ---------- purchase flow ----------

  private async buy(product: Product): Promise<void> {
    const provider = this.provider;
    if (!provider || this.state !== 'ready') return;
    this.purchasingId = product.id;
    this.setState('purchasing');
    void trackProductEvent('purchase_started', PlatformBridge, {
      productId: product.id,
      provider: provider.id,
    });
    let result: PurchaseResult;
    try {
      result = await provider.purchase(product.id);
    } catch (e) {
      result = {
        state: 'failed',
        productId: product.id,
        provider: provider.id,
        reason: e instanceof Error ? e.message : 'unknown',
      };
    }
    if (!this.sys.isActive()) return;
    this.purchasingId = null;
    if (result.state === 'success') {
      // Выдача — до экрана успеха: «Выдано» означает выданное.
      applyPurchaseGrants(product);
      void trackProductEvent('purchase_completed', PlatformBridge, {
        productId: product.id,
        provider: provider.id,
      });
      this.lastBought = product;
      this.setState('success');
    } else {
      void trackProductEvent('purchase_failed', PlatformBridge, {
        productId: product.id,
        provider: provider.id,
        reason: result.reason,
      });
      this.errorReason =
        result.state === 'cancelled' ? 'Покупка отменена' : `Не удалось: ${result.reason}`;
      this.setState('error');
    }
  }

  /** Экран успеха: эмблема выдачи с reveal-твином (без Juice — см. шапку). */
  private renderSuccessOverlay(): void {
    if (!this.root || !this.lastBought) return;
    const W = this.scale.width;
    const H = this.scale.height;
    const product = this.lastBought;
    const dim = this.add
      .rectangle(W / 2, H / 2, W, H, 0x050308, 0.82)
      .setInteractive()
      .setName('ofeliya-storefront-success-dim');
    const emblem = this.add.container(W / 2, H / 2 - 40).setDepth(20);
    const artColor = STUB_PALETTES[product.art.palette] ?? ROLE.faction.reward;
    const ring = this.add.circle(0, 0, 54, artColor, 0.22).setStrokeStyle(3, artColor, 1);
    const check = this.add
      .text(0, 0, '✓', { fontFamily: FONT, fontSize: '44px', fontStyle: 'bold', color: '#7fffa1' })
      .setOrigin(0.5)
      .setResolution(2);
    const label = this.add
      .text(0, 78, product.title, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        align: 'center',
        wordWrap: { width: W - 80 },
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
    const sub = this.add
      .text(0, 108, 'Выдано. Приятной мутации!', {
        fontFamily: UI_FONT,
        fontSize: '12px',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
    emblem.add([ring, check, label, sub]);
    this.root.add([dim, emblem]);
    // Reveal без Juice: масштаб 0.6 → 1 (Back.easeOut, как у панелей);
    // при reduced motion — сразу финальный масштаб, без анимации.
    if (!prefersReducedMotion()) {
      emblem.setScale(0.6);
      this.tweens.add({ targets: emblem, scale: 1, duration: 480, ease: 'Back.easeOut' });
    }

    const dismiss = (): void => {
      if (!this.sys.isActive()) return;
      dim.destroy();
      emblem.destroy(true);
      this.lastBought = null;
      this.setState('ready');
    };
    dim.on('pointerup', dismiss);
    this.time.delayedCall(2400, dismiss);
  }
}
