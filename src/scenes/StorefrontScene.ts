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
import { STOREFRONT_MAX, STOREFRONT_TELEGRAM, isStorefrontVisible, resolveProvider } from '../game/shop/Storefront';
import {
  addPendingPurchase,
  fulfillPurchase,
  loadPendingPurchases,
} from '../game/shop/PaymentLedger';
import { formatPrice, validateCatalog } from '../game/shop/products';
import { grantMetaRna } from '../game/lab/LabState';
import {
  collectLifetimeStats,
  getMetaAchievementDef,
  grantAchievementSkin,
  unlockMetaAchievements,
} from '../game/achievements/MetaAchievements';
import { showMetaToast } from '../ui/RetentionOverlays';
import { showSkinGrantToast } from '../ui/SkinGallery';
import type {
  PaymentProvider,
  Product,
  PurchaseResult,
} from '../game/shop/PaymentProvider';
// Type-only: нужен лишь для acknowledgeCharge (P1-d); стирается при
// компиляции, рантайм-цикла нет, Node-тесты сцену не импортируют.
import type { TelegramStarsPaymentProvider } from '../game/shop/TelegramStarsPaymentProvider';

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
    // apiBaseUrl читаем здесь (import.meta.env безопасен только в браузере;
    // shop-модули Phaser-free и компилируются Node-тестами).
    // Патч №13 (P1-f): QA-инструменты — только dev и сборки с VITE_QA_TOOLS=1.
    // Без них ?flag.-оверрайды игнорируются, а mock-витрина недоступна
    // (resolveProvider('mock') → null, сцена покажет «скоро»).
    const apiBaseUrl = (import.meta.env.VITE_PAYMENTS_API_URL as string | undefined) ?? '';
    const qaTools = import.meta.env.DEV || import.meta.env.VITE_QA_TOOLS === '1';
    if (!isStorefrontVisible(this.variant, { apiBaseUrl })) {
      this.scene.start('Menu');
      return;
    }
    this.provider = resolveProvider(this.variant, { apiBaseUrl, qaTools });

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
    // Патч №12: при открытии витрины допроверяем pending-покупки
    // (verify → verified → fulfillPurchase → снять запись; иначе бэкофф).
    void this.refreshPendingAndRender();

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
    // Telegram — реальный биллинг Stars, а не тестовый режим (в стеке здесь
    // был else-«тестовый режим» и для telegram — исправлено: иначе подпись
    // врала бы про реальные деньги).
    const modeLabel =
      this.variant === STOREFRONT_MAX
        ? 'рельс MAX (заглушка)'
        : this.variant === STOREFRONT_TELEGRAM
          ? 'Telegram Stars · оплата звёздами'
          : 'тестовый режим · без реальных платежей';
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
    // Патч №12: баннер неподтверждённых покупок + ручная допроверка.
    if (this.state === 'ready') {
      const pending = loadPendingPurchases();
      if (pending.length > 0) {
        this.buildPendingBanner(list, 0, cy, width, pending.length);
        cy += 76 + gap;
      }
    }
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
      .text(btnX, btnY, buying ? '···' : this.priceLabel(product), {
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

  /**
   * Ценник кнопки покупки (пост-ревью, патч №11): для Stars — «N ★»,
   * иначе денежный формат каталога.
   */
  private priceLabel(product: Product): string {
    if (this.provider?.id === 'telegram-stars' && product.stars) return `${product.stars} ★`;
    return formatPrice(product.price);
  }

  /**
   * Патч №12: баннер «Ожидание подтверждения» для pending-покупок
   * (сервер ещё не подтвердил оплату — выдачи нет). Кнопка «Проверить
   * оплату» — ручная допроверка через provider.restore()
   * (авто-ретраи с бэкоффом 2с/5с/15с/60с идут в сессии сами).
   */
  private buildPendingBanner(
    parent: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    width: number,
    count: number
  ): void {
    const bannerH = 76;
    const banner = this.add.container(cx, cy);
    const bg = this.add
      .rectangle(0, 0, width, bannerH, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, 0xffe066, 0.9)
      .setOrigin(0.5, 0);
    const label = this.add
      .text(-width / 2 + 16, 12, `ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ${count > 1 ? ` · ${count}` : ''}`, {
        fontFamily: FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setOrigin(0, 0)
      .setResolution(2);
    const sub = this.add
      .text(-width / 2 + 16, 32, 'Платёж обрабатывается. Товар выдадим автоматически.', {
        fontFamily: UI_FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
        wordWrap: { width: width - 140 },
      })
      .setOrigin(0, 0)
      .setResolution(2);
    const btnW = 108;
    const btnH = Math.max(TOUCH.min, 40);
    const btnX = width / 2 - 12 - btnW / 2;
    const btnBg = this.add
      .rectangle(btnX, bannerH / 2, btnW, btnH, ROLE.surface.panelHover, PANEL.button)
      .setStrokeStyle(BORDER.thin, 0xffe066, 0.8)
      .setInteractive({ useHandCursor: true });
    const btnLabel = this.add
      .text(btnX, bannerH / 2, 'ПРОВЕРИТЬ', {
        fontFamily: FONT,
        fontSize: '11px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setResolution(2);
    let checking = false;
    btnBg.on('pointerdown', () => btnBg.setAlpha(0.6));
    btnBg.on('pointerup', () => {
      btnBg.setAlpha(1);
      if (checking || !this.provider) return;
      checking = true;
      btnLabel.setText('···');
      // Перерендер заменяет баннер, поэтому текст кнопки назад не ставим.
      void this.refreshPendingAndRender();
    });
    banner.add([bg, label, sub, btnBg, btnLabel]);
    parent.add(banner);
  }

  /**
   * Патч №12: допроверка pending-покупок + аналитика выданных +
   * перерендер, когда уместно (состояние ready/empty). Вызывается при
   * открытии витрины и кнопкой «Проверить оплату». Никогда не бросает
   * (MaxBridge restore() бросает — stub).
   */
  private async refreshPendingAndRender(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    let fulfilled: string[] = [];
    try {
      const res = await provider.restore();
      fulfilled = res.pendingFulfilled ?? [];
    } catch {
      /* restore не должен ронять витрину */
    }
    for (const id of fulfilled) {
      void trackProductEvent('purchase_completed', PlatformBridge, {
        productId: id,
        provider: provider.id,
      });
    }
    if (this.sys.isActive() && (this.state === 'ready' || this.state === 'empty')) {
      this.renderContent();
    }
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
    // Патч №12 (E3): грант, аналитика и разблокировка достижений не зависят
    // от сцены — выполняем ДО проверки isActive. Сцена могла деактивироваться
    // во время асинхронной оплаты (жест «назад», рестарт), и успешный платёж
    // не должен теряться молча. Тосты — ТОЛЬКО на активной сцене (после
    // проверки), поэтому здесь лишь собираем их данные.
    interface PendingToast {
      title: string;
      sub: string;
      skinId?: string;
    }
    const pendingToasts: PendingToast[] = [];
    // Патч №13 (P1-a): успех UI — ТОЛЬКО при ok от fulfillPurchase.
    let grantFailed = false;
    if (result.state === 'paid') {
      // Выдача — только через ledger: идемпотентность по chargeId,
      // recordStarsSpent — только у реальных провайдеров (не 'mock').
      // purchase_completed — только при первой выдаче ('granted'), чтобы
      // повтор ('duplicate') не считал покупку дважды.
      const grant = fulfillPurchase(product, { chargeId: result.chargeId, providerId: provider.id });
      if (grant.outcome === 'granted') {
        void trackProductEvent('purchase_completed', PlatformBridge, {
          productId: product.id,
          provider: provider.id,
        });
      }
      if (!grant.ok) {
        // Товар не выдан (платёж при этом подтверждён сервером и не
        // потерян: допроверка/повторная выдача — в restore()).
        grantFailed = true;
        void trackProductEvent('purchase_grant_failed', PlatformBridge, {
          productId: product.id,
          provider: provider.id,
          error: grant.error ?? grant.outcome,
        });
      } else {
        // Патч №13 (P1-d): bookkeeping воркера — после успешной выдачи
        // сообщаем paid→fulfilled. Только telegram-провайдер и только
        // реальный chargeId; fire-and-forget, на результат не влияет.
        if (provider.id === 'telegram-stars') {
          (provider as TelegramStarsPaymentProvider).acknowledgeCharge(result.chargeId);
        }
        // Достижения проверяем сразу: игрок получает награду (напр. скин
        // «Инвестора» за 500 звёзд) не дожидаясь конца забега.
        for (const id of unlockMetaAchievements(collectLifetimeStats())) {
          const def = getMetaAchievementDef(id);
          if (def.reward.kind === 'rna') {
            const granted = grantMetaRna(def.reward.amount).granted;
            pendingToasts.push({ title: def.title, sub: `+${granted} РНК` });
          } else {
            grantAchievementSkin(def.reward.skinId);
            pendingToasts.push({ title: def.title, sub: '', skinId: def.reward.skinId });
          }
          void trackProductEvent('achievement_unlocked', PlatformBridge, { achievementId: id });
        }
      }
    } else if (result.state === 'pending') {
      // Сервер не подтвердил оплату: БЕЗ выдачи. Сохраняем в pending-журнал —
      // допроверка в restore() (при открытии витрины) и кнопкой
      // «Проверить оплату». UI — баннер в renderList.
      addPendingPurchase({
        nonce: result.nonce,
        productId: product.id,
        stars: product.stars ?? 0,
        createdAt: Date.now(),
      });
      void trackProductEvent('purchase_pending', PlatformBridge, {
        productId: product.id,
        provider: provider.id,
        reason: result.reason ?? '',
      });
    } else {
      void trackProductEvent('purchase_failed', PlatformBridge, {
        productId: product.id,
        provider: provider.id,
        reason: result.reason,
      });
    }
    if (!this.sys.isActive()) return;
    // E3: тосты — только после проверки isActive (Phaser-объекты сцены).
    for (const t of pendingToasts) {
      if (t.skinId) showSkinGrantToast(this, t.skinId);
      else showMetaToast(this, t.title, t.sub);
    }
    this.purchasingId = null;
    if (result.state === 'paid' && !grantFailed) {
      this.lastBought = product;
      this.setState('success');
    } else if (result.state === 'paid') {
      // Платёж подтверждён сервером, но выдача не удалась (ok=false):
      // товар не потерян — допроверка и повторная выдача в restore().
      this.errorReason = 'Не удалось выдать товар — проверьте оплату позже';
      this.setState('error');
    } else if (result.state === 'pending') {
      // Баннер «Ожидание подтверждения» рисуется в renderList.
      this.setState('ready');
    } else {
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
