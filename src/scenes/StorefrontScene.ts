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
import { BORDER, BP, CLAMP, PANEL, ROLE, SPACE, TOUCH } from '../ui/tokens';
import { VISUAL_TEXT } from '../ui/visualTokens';
import { STOREFRONT_MAX, STOREFRONT_TELEGRAM, isStorefrontVisible, resolveProvider } from '../game/shop/Storefront';
import {
  addPendingPurchase,
  fulfillPurchase,
  loadPendingPurchases,
} from '../game/shop/PaymentLedger';
import {
  enqueuePendingWalletSync,
  getPendingSyncChargeIds,
  hasManualCheckEntries,
} from '../game/shop/PendingWalletSync';
import { formatPrice, validateCatalog } from '../game/shop/products';
import { getSeasonPassUntilMs, isSeasonPassActive } from '../game/meta/MetaWallet';
import { INVITE_SHARE_TEXT, buildInvitePayloadFromInitData } from '../game/shop/invite';
import { getCollab, type CollabDef } from '../game/shop/collabs';
import {
  SEASON_MISSIONS,
  seasonDisplayName,
  seasonIdFor,
  seasonSnapshot,
} from '../game/shop/seasonQuests';
import { grantMetaRna } from '../game/lab/LabState';
import {
  collectLifetimeStats,
  getMetaAchievementDef,
  grantAchievementSkin,
  unlockMetaAchievements,
} from '../game/achievements/MetaAchievements';
import { showMetaToast } from '../ui/RetentionOverlays';
import { showSkinGrantToast } from '../ui/SkinGallery';
import { ScrollViewport } from '../ui/ScrollViewport';
import { MenuKeyboard, type MenuKeyboardControl } from '../ui/MenuKeyboard';
import { addUiIcon } from '../ui/uiIcons';
import type { UiIconFrame } from '../ui/generated/iconFrames';
import type {
  PaymentProvider,
  Product,
  PurchaseFailure,
  PurchaseResult,
} from '../game/shop/PaymentProvider';
// Type-only: нужен для acknowledgeCharge и syncWalletAndDrainPending;
// стирается при компиляции, рантайм-цикла нет, Node-тесты сцену не импортируют.
import type { TelegramStarsPaymentProvider } from '../game/shop/TelegramStarsPaymentProvider';

type SceneState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'purchasing'
  | 'success'
  | 'sync-pending'
  | 'unavailable';

/** Патч №16 (A3): покупка, чей синк кошелька не подтверждён. */
interface SyncPendingInfo {
  productId: string;
  productTitle: string;
  chargeId: string;
  error: string;
}

/**
 * Человекочитаемое сообщение об ошибке покупки по машиночитаемой причине
 * (P2-N2 (b), P3-N7). Неизвестные причины — как раньше, с кодом: игрок
 * видит, что случилось, а поддержка получает точный reason.
 * Тексты — по канону GAME_LANGUAGE_BIBLE: без внутренних терминов
 * (nonce/verify/duplicate) и без обещания сроков возврата.
 */
export function purchaseFailureMessage(result: PurchaseFailure): string {
  if (result.state === 'cancelled') return 'Покупка отменена';
  switch (result.reason) {
    case 'verify-denied':
    case 'verify-duplicate':
      // P2-N2 (b): сервер отклонил платёж — возврат оформляется сервером.
      return 'Платёж отклонён — возврат оформляется. Поддержка: /paysupport';
    case 'subscription-active':
      // P3-N7: пропуск уже активен — второй не нужен.
      return 'Пропуск уже активен';
    case 'subscription-pending':
      // P3-N7: оплата пропуска уже идёт — дождитесь подтверждения.
      return 'Ожидается оплата пропуска';
    default:
      return `Не удалось: ${result.reason}`;
  }
}

/**
 * P2-N4: порог тапа — pointerup после смещения >= 10px не клик (иначе
 * прерванный скролл с кнопки покупает). Phaser.Pointer несёт downX/downY
 * (координаты pointerdown), поэтому порог — stateless: сравниваем
 * pointer.x/y с pointer.downX/downY в pointerup.
 */
export const STOREFRONT_TAP_THRESHOLD_PX = 10;

function isTap(pointer: Phaser.Input.Pointer): boolean {
  const dx = pointer.x - pointer.downX;
  const dy = pointer.y - pointer.downY;
  return Math.hypot(dx, dy) < STOREFRONT_TAP_THRESHOLD_PX;
}

/**
 * P2-N4: кнопка с порогом тапа. pointerdown — затемнение; pointerup —
 * действие ТОЛЬКО если смещение < 10px (иначе это был drag/скролл);
 * pointerout — снять затемнение без действия (иначе drag-off оставляет
 * кнопку затемнённой).
 */
function wireTapButton(btn: Phaser.GameObjects.Rectangle, onTap: () => void): void {
  btn.on('pointerdown', () => btn.setAlpha(0.6));
  btn.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    btn.setAlpha(1);
    if (!pointer.wasCanceled && isTap(pointer)) onTap();
  });
  btn.on('pointerout', () => btn.setAlpha(1));
}

/** Палитры заглушек арта (до DiceBear-рендера Фазы 5). */
const STUB_PALETTES: Record<string, number> = {
  magenta: 0xff4fb5,
  teal: 0x2fd6c0,
  gold: 0xffd56a,
  green: 0x7fffa1,
  cyan: 0x8fe8ff,
};

/**
 * Адаптивная компоновка карточек витрины (P1-4): высота карточки считается
 * по измеренной высоте текстов (title.height / desc.height после layout),
 * а не фиксирована. Никаких фиксированных Y внутри текстовых блоков:
 * фиксированный statusY=80 был причиной наезда статуса пропуска на
 * описание. Кегли — по readability-контракту: заголовок 16px, описание
 * 11px (compact) / 12px (normal).
 */
const CARD_PAD_X = 12;
const CARD_PAD_TOP = 12;
const CARD_PAD_BOTTOM = 12;
const CARD_MEDALLION_R = 24;
const CARD_TITLE_SIZE = 16;
const CARD_DESC_SIZE = { compact: 11, normal: 12 } as const;
const CARD_BTN_W = 112;
const CARD_BTN_H = 44;
const CARD_GAP_HEADER_DESC = 8;
const CARD_GAP_DESC_BTN = 10;
const CARD_GAP_STATUS = 4;

function productIconFrame(kind: Product['kind']): UiIconFrame {
  if (kind === 'skin') return 'virus';
  if (kind === 'booster') return 'bolt';
  if (kind === 'currency') return 'dna';
  if (kind === 'season_pass') return 'ribbon';
  return 'gift';
}

export class StorefrontScene extends Phaser.Scene {
  private provider: PaymentProvider | null = null;
  private variant = 'hidden';
  private state: SceneState = 'loading';
  /**
   * CR3: состояние restore. 'pending' — restore ещё не завершён, и
   * состояние пропуска НЕИЗВЕСТНО: на чистой установке
   * isSeasonPassActive() false, пока restore не записал
   * seasonPassUntilMs, — покупка пропуска блокируется (кнопка '···'),
   * иначе клиент предложит второй пропуск при активном серверном.
   * 'known' — restore завершён (успешно или нет — лучше информации не
   * будет); серверный 409 из P1-2 остаётся backstop'ом. Сбрасывается
   * в create() (рестарт при resize — новый restore).
   */
  private restoreState: 'pending' | 'known' = 'pending';
  private products: Product[] = [];
  private errorReason = '';
  private purchasingId: string | null = null;
  /**
   * CR-R3-10: поколение сцены — инкремент в create() (рестарт при resize
   * проходит через create на том же экземпляре). Асинхронные продолжения
   * (buy) захватывают поколение на старте и не трогают UI чужого
   * поколения: исходная покупка дорабатывает платёжную бухгалтерию, но
   * не переписывает состояние новой генерации.
   */
  private generation = 0;
  /**
   * CR-R3-10: покупка в полёте — переживает рестарт сцены (НЕ сбрасывается
   * в create): после resize новая генерация не может начать вторую покупку,
   * пока не завершилась исходная. Снимается в finally buy().
   */
  private inFlightPurchase: { productId: string; generation: number } | null = null;
  private lastBought: Product | null = null;
  /** Патч №16 (A3): покупка с неподтверждённым синком (баннер + «Повторить»). */
  private syncPending: SyncPendingInfo | null = null;
  /**
   * Монетизация v3: товары, за которые уже отправлен product_view в этой
   * сессии магазина. Карточки перерисовываются при каждом renderContent —
   * без дедупликации воронка считала бы просмотры на каждый ре-рендер.
   * Сбрасывается в create() (одно открытие магазина = одна сессия).
   */
  private viewedProducts = new Set<string>();
  /**
   * Монетизация v3: коллаб из данных сцены (MenuScene передаёт collabId
   * при входе по диплинку). null — обычный вход / неизвестный id.
   */
  private collab: CollabDef | null = null;
  /**
   * Монетизация v3: ссылка-приглашение (t.me … startapp=t_<uid>).
   * Только Telegram: на других платформах нет Telegram user id.
   * null — не Telegram / нет id / бот не сконфигурирован.
   */
  private inviteLink: string | null = null;

  private root: Phaser.GameObjects.Container | null = null;
  private listContainer: Phaser.GameObjects.Container | null = null;
  private viewport: ScrollViewport | null = null;
  private keyboard: MenuKeyboard | null = null;
  /** P1-4: низ шапки от измеренной подписи режима (buildChrome). */
  private chromeBottom = 96;
  private scrollHit: Phaser.GameObjects.Zone | null = null;
  private listButtons: Phaser.GameObjects.Rectangle[] = [];
  private listFocusTargets: MenuKeyboardControl[] = [];
  private scrollOffset = 0;
  private scrollLimit = 0;

  constructor() {
    super({ key: 'Storefront' });
  }

  /**
   * Монетизация v3: данные сцены — только collabId (от MenuScene при
   * входе по коллаб-диплинку). Неизвестный id → null (обычная витрина).
   */
  init(data?: { collabId?: string }): void {
    this.collab =
      typeof data?.collabId === 'string' ? getCollab(data.collabId) ?? null : null;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    // CR-R3-10: новое поколение (рестарт при resize — тоже): продолжения
    // buy из прошлого поколения после этого UI не трогают. inFlightPurchase
    // НЕ сбрасывается — гейт покупки переживает рестарт.
    this.generation += 1;
    // P1-4: рестарт при resize (onResize) проходит через create() заново
    // на том же экземпляре сцены — сбрасываем состояние, иначе сцена
    // стартует с «purchasing» и указателями на уничтоженные объекты.
    this.state = 'loading';
    this.purchasingId = null;
    this.restoreState = 'pending';
    this.scrollOffset = 0;
    this.scrollLimit = 0;
    this.listContainer = null;
    this.viewport = null;
    this.scrollHit = null;
    this.listButtons = [];
    this.listFocusTargets = [];
    // Resize — до раннего возврата: иначе слушатель переживёт уход в меню.
    this.scale.on('resize', this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
      this.clearListMask();
      this.listContainer = null;
      this.keyboard = null;
      this.root?.destroy(true);
      this.root = null;
    });
    this.variant = FeatureFlags.get('storefront.variant');
    // Монетизация v3: новое открытие магазина — новая сессия просмотров.
    this.viewedProducts.clear();
    // Монетизация v3: ссылка-приглашение — только в Telegram
    // (user id берётся из initData; на MAX/браузере его нет).
    const invitePayload =
      PlatformBridge.kind === 'telegram'
        ? buildInvitePayloadFromInitData(PlatformBridge.initData)
        : null;
    this.inviteLink = invitePayload
      ? PlatformBridge.buildStartLink(invitePayload)
      : null;

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
    this.keyboard = new MenuKeyboard(this, {
      blocked: () => this.state === 'success',
      escape: () => {
        if (this.state === 'success') return false;
        this.scene.start('Menu');
        return true;
      },
    });

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
  }

  /** P1-4: resize — перестройка с нуля, как в MenuScene (layout от размеров). */
  private onResize(): void {
    this.scene.restart();
  }

  // ---------- layout ----------

  private buildChrome(): void {
    const W = this.scale.width;
    this.root = this.add.container(0, 0).setDepth(10).setName('ofeliya-storefront');

    // Кнопка «назад» — 84px: прежние 104px перекрывали заголовок на 320.
    const backW = 84;
    const backH = Math.max(TOUCH.min, 40);
    const backBg = this.add
      .rectangle(12 + backW / 2, 44, backW, backH, ROLE.surface.panel, PANEL.button)
      .setStrokeStyle(BORDER.thin, ROLE.surface.stroke, 0.8)
      .setInteractive({ useHandCursor: true });
    const backLabel = this.add
      .text(12 + backW / 2 + 8, 44, 'НАЗАД', {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0.5)
      .setResolution(2);
    const backIcon = addUiIcon(this, 26, 44, 'arrow-left').setDisplaySize(17, 17);
    const goBack = (): void => { this.scene.start('Menu'); };
    wireTapButton(backBg, goBack);
    this.keyboard?.add(backBg, () => 'Назад', goBack);
    this.root.add([backBg, backLabel, backIcon]);

    // Заголовок — по центру, но сдвигается вправо, если измеренная ширина
    // упирается в кнопку «назад» (на 320 иначе пересечение).
    const title = this.add
      .text(0, 44, 'ВИТРИНА', {
        fontFamily: FONT,
        fontSize: '20px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        letterSpacing: 3,
      })
      .setOrigin(0.5)
      .setResolution(2);
    const backRight = 12 + backW;
    title.setX(
      Phaser.Math.Clamp(
        Math.max(W / 2, backRight + 10 + title.width / 2),
        title.width / 2 + 12,
        W - 12 - title.width / 2
      )
    );
    this.root.add(title);

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
      .text(W / 2, 68, modeLabel, {
        fontFamily: UI_FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
        wordWrap: { width: W - 24 },
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
    this.root.add(mode);
    // P1-4: низ шапки — от измеренной подписи режима, а не константа:
    // если подпись перенесётся на две строки, контент не наедет на неё.
    this.chromeBottom = Math.ceil(68 + mode.height + 12);
  }

  /** Область контента под шапкой. */
  private contentRect(): { x: number; top: number; width: number; height: number } {
    const W = this.scale.width;
    const H = this.scale.height;
    const width = Math.min(W - CLAMP.padScreen * 2, CLAMP.panelMax);
    const top = this.chromeBottom;
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
    // P1-4: catcher тоже уничтожаем — раньше он оставался в root и
    // копился по одному на каждый ре-рендер списка.
    this.scrollHit?.destroy();
    this.scrollHit = null;
    this.listButtons = [];
    this.listFocusTargets = [];
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
      case 'sync-pending':
        // Патч №16 (A3): список + баннер «Оплата подтверждена, товар ожидает
        // синхронизации» с кнопкой «Повторить» (рисуется в renderList).
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
    wireTapButton(btn, () => {
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
      // Монетизация v3: стартовый набор прячется флагом (kill-switch
      // видимости; валидация выше идёт по полному каталогу). Сервер флаг
      // не читает — покупка по id всё равно выдаст снапшот.
      const visible = FeatureFlags.get('monetization.starter-pack')
        ? products
        : products.filter((p) => p.id !== 'bundle.starter-pack');
      this.products = visible;
      this.setState(visible.length === 0 ? 'empty' : 'ready');
    } catch (e) {
      if (!this.sys.isActive()) return;
      this.errorReason = e instanceof Error ? e.message : 'unknown';
      this.setState('error');
    }
  }

  private renderList(x: number, top: number, width: number, height: number): void {
    if (!this.root) return;
    const list = this.add.container(x, top).setName('ofeliya-storefront-list');
    this.listContainer = list;
    this.listButtons = [];
    this.listFocusTargets = [];
    this.root.add(list);

    const gap = SPACE.md;
    let cy = 0;
    if (this.state === 'ready') {
      const pending = loadPendingPurchases();
      if (pending.length > 0) {
        cy += this.buildPendingBanner(list, 0, cy, width, pending.length) + gap;
      }
    }
    if (this.state === 'ready' || this.state === 'sync-pending') {
      const syncInfo = this.syncPending;
      const queued = getPendingSyncChargeIds();
      const manual = hasManualCheckEntries();
      if (syncInfo || queued.length > 0 || manual) {
        cy += this.buildSyncBanner(list, 0, cy, width, {
          title: syncInfo ? syncInfo.productTitle : undefined,
          queued: queued.length,
          manual,
        }) + gap;
      }
    }
    if (this.state === 'ready' && this.collab) {
      cy += this.buildCollabBanner(list, 0, cy, width, this.collab) + gap;
    }
    if (this.state === 'ready' && this.inviteLink) {
      cy += this.buildInviteBanner(list, 0, cy, width, this.inviteLink) + gap;
    }
    for (const product of this.products) {
      cy += this.buildCard(list, product, 0, cy, width) + gap;
    }
    const totalH = Math.max(0, cy - gap);
    this.viewport = new ScrollViewport(this, {
      parent: this.root,
      content: list,
      bounds: { x: x - width / 2, y: top, width, height },
      contentHeight: totalH,
      name: 'ofeliya-storefront',
      keyboard: this.keyboard ?? undefined,
      blocked: () => this.state === 'success',
      escape: () => {
        if (this.state === 'success') return false;
        this.scene.start('Menu');
        return true;
      },
      onChange: (offset, limit) => {
        this.scrollOffset = offset;
        this.scrollLimit = limit;
      },
    });
    this.viewport.setFocusTargets(this.listFocusTargets);
    this.scrollHit = this.viewport.hitZone;
  }

  private applyScroll(next: number): void {
    this.viewport?.scrollTo(next);
  }

  /**
   * P1-4: маска режет только отрисовку, но не хит-тест — кнопка карточки,
   * уехавшей за край контентной области, остаётся кликабельной, хотя её
   * не видно (тап в шапку мог случайно начать покупку невидимого товара).
   * CR-R3-11: инпут включён только когда ВСЯ кнопка внутри контентной
   * области. Раньше проверялся только центр: кнопка 44px с центром на
   * 1px внутри оставалась кликабельной на 21px в шапке — тап по
   * невидимой части вызывал покупку. Частично видимая кнопка не
   * кликабельна: игрок чуть докручивает скролл до полного показа.
   */
  private updateListButtonInput(): void {
    this.viewport?.refresh();
  }

  private clearListMask(): void {
    this.viewport?.destroy();
    this.viewport = null;
  }

  /**
   * P1-4: карточка товара — стековая компоновка с измеренной высотой.
   *
   *   шапка: медальон + заголовок (переносится, тег резервирует место)
   *   описание: на всю ширину карточки (было 68px на 320 — нечитаемо)
   *   пропуск: разделитель + срок/сезон/награды отдельными строками
   *   кнопка цены: отдельной строкой под текстом, справа
   *
   * Высота возвращается вызывающему (renderList) — карточка растёт под
   * свой текст, а не обрезает его. Возвращает высоту карточки.
   */
  private buildCard(
    parent: Phaser.GameObjects.Container,
    product: Product,
    cx: number,
    cy: number,
    width: number
  ): number {
    // Монетизация v3: product_view — один раз на товар за сессию магазина.
    if (!this.viewedProducts.has(product.id)) {
      this.viewedProducts.add(product.id);
      void trackProductEvent('product_view', PlatformBridge, { productId: product.id });
    }
    const compact = this.scale.height < BP.compact;
    const descSize = compact ? CARD_DESC_SIZE.compact : CARD_DESC_SIZE.normal;
    const card = this.add.container(cx, cy).setName(`ofeliya-store-card-${product.id}`);
    const children: Phaser.GameObjects.GameObject[] = [];

    // Тег — первым: его измеренная ширина резервируется в строке заголовка,
    // чтобы длинный заголовок переносился, а не резался тегом.
    let tagW = 0;
    if (product.tag) {
      const tag = this.add
        .text(width / 2 - CARD_PAD_X, CARD_PAD_TOP, product.tag, {
          fontFamily: FONT,
          fontSize: '10px',
          fontStyle: 'bold',
          color: '#0b0f1a',
          backgroundColor: '#ffd56a',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(1, 0)
        .setResolution(2)
        .setName('card-tag');
      tagW = tag.width;
      children.push(tag);
    }

    // Заголовок: переносится в пределах текстовой колонки (минус тег).
    const titleX = -width / 2 + CARD_PAD_X + CARD_MEDALLION_R * 2 + 10;
    const titleRight = product.tag
      ? width / 2 - CARD_PAD_X - tagW - 8
      : width / 2 - CARD_PAD_X;
    const title = this.add
      .text(titleX, CARD_PAD_TOP, product.title, {
        fontFamily: FONT,
        fontSize: `${CARD_TITLE_SIZE}px`,
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        wordWrap: { width: Math.max(60, titleRight - titleX) },
      })
      .setOrigin(0, 0)
      .setResolution(2)
      .setName('card-title');
    children.push(title);

    // Шапка: медальон + заголовок; высота — по большему из них.
    const headerH = Math.max(CARD_MEDALLION_R * 2, title.height);
    title.setY(CARD_PAD_TOP + (headerH - title.height) / 2);

    const artColor = STUB_PALETTES[product.art.palette] ?? ROLE.faction.neutral;
    const medallion = this.add.container(
      -width / 2 + CARD_PAD_X + CARD_MEDALLION_R,
      CARD_PAD_TOP + headerH / 2
    );
    const disc = this.add.circle(0, 0, CARD_MEDALLION_R, artColor, 0.28).setStrokeStyle(2, artColor, 0.9);
    const icon = addUiIcon(this, 0, 0, productIconFrame(product.kind), 'host').setDisplaySize(30, 30);
    medallion.add([disc, icon]);
    children.push(medallion);

    // Описание — на всю ширину карточки.
    const descY = CARD_PAD_TOP + headerH + CARD_GAP_HEADER_DESC;
    const desc = this.add
      .text(-width / 2 + CARD_PAD_X, descY, product.description, {
        fontFamily: UI_FONT,
        fontSize: `${descSize}px`,
        color: VISUAL_TEXT.muted,
        wordWrap: { width: width - CARD_PAD_X * 2 },
        lineSpacing: 2,
      })
      .setOrigin(0, 0)
      .setResolution(2)
      .setName('card-desc');
    children.push(desc);
    let y = descY + desc.height;

    // Монетизация v3: карточка пропуска — статус и сезон отдельными
    // строками за разделителем, ниже измеренного описания. Активный
    // пропуск НЕ продаётся повторно: подписка Telegram продлевается
    // автоматически, а вторая покупка создала бы параллельную подписку
    // (двойное списание) — кнопка становится неактивным статусом.
    // Отмену подписки игрок делает в настройках Telegram (Stars).
    if (product.kind === 'season_pass') {
      y += 8;
      const divider = this.add
        .rectangle(0, y, width - CARD_PAD_X * 2, 1, ROLE.surface.stroke, 0.6)
        .setOrigin(0.5, 0);
      children.push(divider);
      y += 1 + 8;
      const passActive = isSeasonPassActive();
      const season = seasonSnapshot();
      const done = season.filter((p) => p.complete).length;
      const claimed = season.filter((p) => p.claimed).length;
      const lineA = passActive
        ? `Активен до ${this.fmtDate(getSeasonPassUntilMs())}`
        : `Сезон ${seasonDisplayName(seasonIdFor(Date.now()))}: ${done}/${season.length} выполнено`;
      const lineB = passActive
        ? `Сезон: ${done}/${season.length} выполнено · наград забрано ${claimed}`
        : this.paidTrackSummary();
      const status1 = this.add
        .text(-width / 2 + CARD_PAD_X, y, lineA, {
          fontFamily: UI_FONT,
          fontSize: `${descSize}px`,
          fontStyle: 'bold',
          color: passActive ? VISUAL_TEXT.host : VISUAL_TEXT.muted,
          wordWrap: { width: width - CARD_PAD_X * 2 },
        })
        .setOrigin(0, 0)
        .setResolution(2)
        .setName('card-status-1');
      children.push(status1);
      y += status1.height + CARD_GAP_STATUS;
      const status2 = this.add
        .text(-width / 2 + CARD_PAD_X, y, lineB, {
          fontFamily: UI_FONT,
          fontSize: `${descSize}px`,
          color: VISUAL_TEXT.muted,
          wordWrap: { width: width - CARD_PAD_X * 2 },
        })
        .setOrigin(0, 0)
        .setResolution(2)
        .setName('card-status-2');
      children.push(status2);
      y += status2.height;
    }

    // Кнопка цены — отдельной строкой под текстом, справа.
    const btnY = y + CARD_GAP_DESC_BTN + CARD_BTN_H / 2;
    const btnX = width / 2 - CARD_PAD_X - CARD_BTN_W / 2;
    // CR-R3-10: '···' — и у покупки из прошлого поколения (рестарт при
    // resize): гейт переживает рестарт, кнопка не должна выглядеть
    // доступной, пока исходная покупка в полёте.
    const buying =
      (this.state === 'purchasing' && this.purchasingId === product.id) ||
      this.inFlightPurchase?.productId === product.id;
    // Монетизация v3: активный пропуск не продаётся (см. выше).
    const passOwned = product.kind === 'season_pass' && isSeasonPassActive();
    // CR3: пока restore не завершён, состояние пропуска НЕИЗВЕСТНО —
    // кнопка заблокирована ('···'), как при покупке.
    const passUnknown = product.kind === 'season_pass' && this.restoreState === 'pending';
    const btnDisabled = buying || passOwned || passUnknown;
    const btnBg = this.add
      .rectangle(
        btnX,
        btnY,
        CARD_BTN_W,
        CARD_BTN_H,
        passOwned ? ROLE.surface.panel : ROLE.faction.reward,
        btnDisabled ? 0.55 : PANEL.button
      )
      .setStrokeStyle(BORDER.thin, 0x0b0f1a, 0.6)
      .setInteractive({ useHandCursor: !btnDisabled })
      .setName('card-buy');
    const btnLabel = this.add
      .text(
        btnX,
        btnY,
        buying || passUnknown ? '···' : passOwned ? 'АКТИВЕН' : this.priceLabel(product),
        {
          fontFamily: FONT,
          fontSize: '13px',
          fontStyle: 'bold',
          color: passOwned ? VISUAL_TEXT.muted : '#0b0f1a',
        }
      )
      .setOrigin(0.5)
      .setResolution(2)
      .setName('card-buy-label');
    if (!btnDisabled) {
      const activate = (): void => { void this.buy(product); };
      wireTapButton(btnBg, activate);
      this.listFocusTargets.push({
        id: product.id,
        object: btnBg,
        label: () => `${product.title}. ${this.priceLabel(product)}`,
        activate,
      });
    }
    children.push(btnBg, btnLabel);
    this.listButtons.push(btnBg);

    const height = btnY + CARD_BTN_H / 2 + CARD_PAD_BOTTOM;
    const bg = this.add
      .rectangle(0, 0, width, height, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, ROLE.surface.stroke, 0.85)
      .setOrigin(0.5, 0)
      .setName('card-bg');
    card.add([bg, ...children]);
    parent.add(card);
    return height;
  }

  /**
   * Ценник кнопки покупки (пост-ревью, патч №11): для Stars — «N ★»,
   * иначе денежный формат каталога.
   */
  private priceLabel(product: Product): string {
    if (this.provider?.id === 'telegram-stars' && product.stars) return `${product.stars} ★`;
    return formatPrice(product.price);
  }

  /** Дата «17.12.2026» для статуса пропуска. */
  private fmtDate(ms: number): string {
    try {
      return new Date(ms).toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  /**
   * Монетизация v3: сводка paid-трека для карточки пропуска — считается
   * из каталога SEASON_MISSIONS, а не хардкодится (иначе копипаст
   * рассинхронится с каталогом при первой же правке наград).
   */
  private paidTrackSummary(): string {
    let rna = 0;
    let boosterDays = 0;
    for (const m of SEASON_MISSIONS) {
      if (m.track !== 'paid') continue;
      if (m.reward.kind === 'rna') rna += m.reward.amount;
      else if (m.reward.kind === 'booster') boosterDays += m.reward.days;
    }
    const parts: string[] = [];
    if (rna > 0) parts.push(`+${rna} РНК`);
    if (boosterDays > 0) parts.push(`бустер ×2 на ${boosterDays} дн.`);
    return parts.length > 0 ? `Платный трек: ${parts.join(', ')}` : 'Платный трек сезонных миссий';
  }

  /**
   * P1-4: общий builder баннеров списка (pending/sync/collab/invite).
   * Лейбл + подтекст на всю ширину, кнопка (если есть) отдельной строкой
   * под текстом, справа. Высота — по измеренным текстам. Возвращает
   * высоту баннера.
   */
  private buildInfoBanner(
    parent: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    width: number,
    opts: {
      accent: number;
      label: string;
      labelColor: string;
      sub: string;
      buttonLabel?: string;
      onButton?: (btnLabel: Phaser.GameObjects.Text) => void;
    }
  ): number {
    const banner = this.add.container(cx, cy).setName('ofeliya-store-banner');
    const padX = 16;
    const textW = width - padX * 2;
    const label = this.add
      .text(-width / 2 + padX, 12, opts.label, {
        fontFamily: FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: opts.labelColor,
        wordWrap: { width: textW },
      })
      .setOrigin(0, 0)
      .setResolution(2);
    const sub = this.add
      .text(-width / 2 + padX, 12 + label.height + 6, opts.sub, {
        fontFamily: UI_FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
        wordWrap: { width: textW },
        lineSpacing: 2,
      })
      .setOrigin(0, 0)
      .setResolution(2);
    let y = 12 + label.height + 6 + sub.height;
    const children: Phaser.GameObjects.GameObject[] = [label, sub];
    if (opts.buttonLabel) {
      const btnW = 108;
      const btnH = Math.max(TOUCH.min, 40);
      const btnY = y + 10 + btnH / 2;
      const btnX = width / 2 - padX - btnW / 2;
      const btnBg = this.add
        .rectangle(btnX, btnY, btnW, btnH, ROLE.surface.panelHover, PANEL.button)
        .setStrokeStyle(BORDER.thin, opts.accent, 0.8)
        .setInteractive({ useHandCursor: true });
      const btnLabel = this.add
        .text(btnX, btnY, opts.buttonLabel, {
          fontFamily: FONT,
          fontSize: '11px',
          fontStyle: 'bold',
          color: opts.labelColor,
        })
        .setOrigin(0.5)
        .setResolution(2);
      const activate = (): void => opts.onButton?.(btnLabel);
      wireTapButton(btnBg, activate);
      this.listFocusTargets.push({
        id: `banner-${this.listFocusTargets.length}`,
        object: btnBg,
        label: () => opts.buttonLabel ?? opts.label,
        activate,
      });
      children.push(btnBg, btnLabel);
      this.listButtons.push(btnBg);
      y = btnY + btnH / 2;
    }
    const height = y + 12;
    const bg = this.add
      .rectangle(0, 0, width, height, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, opts.accent, 0.9)
      .setOrigin(0.5, 0);
    banner.add([bg, ...children]);
    parent.add(banner);
    return height;
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
  ): number {
    let checking = false;
    return this.buildInfoBanner(parent, cx, cy, width, {
      accent: 0xffe066,
      label: `ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ${count > 1 ? ` · ${count}` : ''}`,
      labelColor: '#ffe066',
      sub: 'Платёж обрабатывается. Товар выдадим автоматически.',
      buttonLabel: 'ПРОВЕРИТЬ',
      onButton: (btnLabel) => {
        if (checking || !this.provider) return;
        checking = true;
        btnLabel.setText('···');
        // Перерендер заменяет баннер, поэтому текст кнопки назад не ставим.
        void this.refreshPendingAndRender();
      },
    });
  }

  /**
   * Монетизация v3: баннер коллаба (информационный, без кнопки —
   * товар коллаба уже есть в списке карточек ниже).
   */
  private buildCollabBanner(
    parent: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    width: number,
    collab: CollabDef
  ): number {
    return this.buildInfoBanner(parent, cx, cy, width, {
      accent: 0x7fd4ff,
      label: collab.title,
      labelColor: '#7fd4ff',
      sub: collab.description,
    });
  }

  /**
   * Монетизация v3: баннер приглашения. Кнопка шарит реферальную ссылку
   * (t.me … startapp=t_<uid>) через PlatformBridge.shareResult; если
   * шаринг недоступен — фолбэк в буфер обмена. Текст НЕ обещает бонус:
   * автоматической выдачи РНК пригласившему в v1 нет (см. invite.ts).
   */
  private buildInviteBanner(
    parent: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    width: number,
    link: string
  ): number {
    const accent = 0x4bc996;
    const accentCss = '#4bc996';
    return this.buildInfoBanner(parent, cx, cy, width, {
      accent,
      label: 'ПРИГЛАСИ ДРУГА',
      labelColor: accentCss,
      sub: 'Отправь другу ссылку на игру.',
      buttonLabel: 'ПРИГЛАСИТЬ',
      onButton: () => {
        void PlatformBridge.shareResult(INVITE_SHARE_TEXT, link).then((ok) => {
          if (!this.sys.isActive()) return;
          if (ok) {
            showMetaToast(
              this,
              'Приглашение отправлено',
              'Друг зайдёт в игру по твоей ссылке.',
              'ПРИГЛАШЕНИЕ'
            );
            return;
          }
          // Шаринг недоступен — фолбэк в буфер обмена.
          const clipboard =
            typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
          if (clipboard?.writeText) {
            void clipboard.writeText(link).then(
              () => {
                if (this.sys.isActive()) {
                  showMetaToast(
                    this,
                    'Ссылка скопирована',
                    'Отправь её другу любым способом.',
                    'ПРИГЛАШЕНИЕ'
                  );
                }
              },
              () => {
                if (this.sys.isActive()) {
                  showMetaToast(this, 'Шаринг недоступен', 'Скопируй ссылку вручную.', 'ПРИГЛАШЕНИЕ');
                }
              }
            );
            return;
          }
          showMetaToast(this, 'Шаринг недоступен в этом клиенте', '', 'ПРИГЛАШЕНИЕ');
        });
      },
    });
  }

  /**
   * Патч №16 (A3): баннер «Оплата подтверждена, товар ожидает
   * синхронизации». Различимый UI-статус: это НЕ «товар получен» —
   * сервер оплату подтвердил, но грант ещё не материализован локально
   * (синк не удался / несовместимый воркер). Кнопка «ПОВТОРИТЬ» запускает
   * синк + дрэйн вручную; ack уходит только при r.ok.
   */
  private buildSyncBanner(
    parent: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    width: number,
    opts: { title?: string; queued: number; manual: boolean }
  ): number {
    const accent = opts.manual ? 0xff9f6a : 0x8fe8ff;
    const subText = opts.manual
      ? 'Автопроверка исчерпана. Товар не потерян — напишите в поддержку с чеком.'
      : `Товар ожидает синхронизации${opts.queued > 1 ? ` · ${opts.queued}` : ''}${
          opts.title ? `: ${opts.title}` : ''
        }. Появится автоматически.`;
    let retrying = false;
    return this.buildInfoBanner(parent, cx, cy, width, {
      accent,
      label: opts.manual ? 'ТРЕБУЕТСЯ ПРОВЕРКА ОПЛАТЫ' : 'ОПЛАТА ПОДТВЕРЖДЕНА',
      labelColor: '#8fe8ff',
      sub: subText,
      buttonLabel: 'ПОВТОРИТЬ',
      onButton: (btnLabel) => {
        if (retrying) return;
        retrying = true;
        btnLabel.setText('···');
        // Ручной ретрай не сбрасывает кап попыток (без бесконечного цикла):
        // дрэйн подтвердит по ledger'у или оставит запись в очереди.
        void this.retryWalletSync().finally(() => {
          retrying = false;
          if (this.sys.isActive()) this.renderContent();
          else btnLabel.setText('ПОВТОРИТЬ');
        });
      },
    });
  }

  /**
   * Патч №16 (A3): ручной повтор синка кошелька (кнопка баннера).
   * r.ok → тост «Товар успешно получен» + ack; !r.ok → баннер остаётся,
   * запись — в pending-sync очереди. Никогда не бросает.
   */
  private async retryWalletSync(): Promise<void> {
    try {
      const provider = this.provider;
      if (!provider || provider.id !== 'telegram-stars') return;
      const tg = provider as TelegramStarsPaymentProvider;
      const target = this.syncPending;
      const r = await tg.syncWalletAndDrainPending();
      if (!this.sys.isActive()) return;
      // P1-1: ack и тост — только при подтверждённой материализации
      // chargeId в серверном ledger (а не просто r.ok).
      const targetCharge = (target?.chargeId ?? '').trim();
      const materialized =
        r.ok && !!targetCharge && r.applied.grantChargeIds.includes(targetCharge);
      if (materialized) {
        tg.acknowledgeCharge(targetCharge);
        this.syncPending = null;
        showMetaToast(this, 'Товар успешно получен', target?.productTitle ?? '');
        const product = target
          ? this.products.find((p) => p.id === target.productId) ?? null
          : null;
        this.lastBought = product;
        this.setState(product ? 'success' : 'ready');
        void trackProductEvent('purchase_sync_recovered', PlatformBridge, {
          provider: provider.id,
          productId: target?.productId ?? '',
        });
      } else {
        if (target) this.syncPending = { ...target, error: r.ok ? 'not-materialized' : r.error };
        this.setState('sync-pending');
        showMetaToast(this, 'Синхронизация не удалась', 'Проверьте соединение и повторите');
        void trackProductEvent('purchase_sync_retry_failed', PlatformBridge, {
          provider: provider.id,
          error: r.ok ? 'not-materialized' : r.error,
        });
      }
    } catch {
      /* ignore */
    }
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
    let denied: string[] = [];
    try {
      const res = await provider.restore();
      fulfilled = res.pendingFulfilled ?? [];
      denied = res.pendingDenied ?? [];
    } catch {
      /* restore не должен ронять витрину */
    }
    // CR3: restore завершён (успешно или нет — лучше информации не
    // будет): состояние пропуска известно, кнопка пропуска
    // разблокируется перерендером ниже.
    this.restoreState = 'known';
    for (const id of fulfilled) {
      void trackProductEvent('purchase_completed', PlatformBridge, {
        productId: id,
        provider: provider.id,
      });
    }
    // P2-N2 (b): отклонённые pending-записи — тост вместо вечного баннера
    // «Ожидание подтверждения». Тост — один на все (не спамим по товару).
    for (const id of denied) {
      void trackProductEvent('purchase_denied', PlatformBridge, {
        productId: id,
        provider: provider.id,
      });
    }
    if (denied.length > 0 && this.sys.isActive()) {
      showMetaToast(
        this,
        'Платёж отклонён',
        'Возврат оформляется. Поддержка — /paysupport',
        'ПЛАТЁЖ'
      );
    }
    if (this.sys.isActive() && (this.state === 'ready' || this.state === 'empty')) {
      this.renderContent();
    }
  }

  // ---------- purchase flow ----------

  /**
   * CR-R3-10: гейт покупки переживает рестарт сцены. buyInner захватывает
   * поколение на старте: бухгалтерия (fulfill, синк кошелька, достижения,
   * аналитика) дорабатывает всегда, а UI-хвост — только в своём поколении.
   */
  private async buy(product: Product): Promise<void> {
    const provider = this.provider;
    if (!provider || this.state !== 'ready') return;
    // CR3: покупка пропуска до известного состояния restore блокируется
    // (кнопка в этом состоянии не wired — это defense in depth).
    if (product.kind === 'season_pass' && this.restoreState === 'pending') return;
    // CR-R3-10: вторая покупка не начинается, пока в полёте исходная
    // (хоть из прошлого поколения — рестарт при resize гейт не снимает).
    if (this.inFlightPurchase) return;
    const gen = this.generation;
    this.inFlightPurchase = { productId: product.id, generation: gen };
    try {
      await this.buyInner(product, provider, gen);
    } finally {
      if (this.inFlightPurchase?.generation === gen) this.inFlightPurchase = null;
      // CR-R3-10: исходная покупка завершилась в чужой генерации —
      // обновить кнопки новой генерации (снять '···'), если это безопасно:
      // renderContent только в состояниях со списком, без оверлеев.
      if (
        gen !== this.generation &&
        this.sys.isActive() &&
        (this.state === 'ready' || this.state === 'empty' || this.state === 'sync-pending')
      ) {
        this.renderContent();
      }
    }
  }

  private async buyInner(product: Product, provider: PaymentProvider, gen: number): Promise<void> {
    this.purchasingId = product.id;
    this.syncPending = null;
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
      // Патч №16 (A4): у telegram-stars выдача серверно-авторитетная —
      // fulfillPurchase лишь учитывает платёж (needsServerSync), грант
      // материализуется seq-синком кошелька ниже.
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
        // Патч №16 (A3): выдача серверно-авторитетная — материализуем
        // серверный кошелёк ДО достижений/тостов, чтобы UI видел покупку.
        // SyncResult НЕ игнорируется (был P0 A3):
        //   r.ok  → тост «Товар успешно получен» + acknowledgeCharge
        //           ТОЛЬКО здесь;
        //   !r.ok → pending-sync очередь + различимый UI-статус
        //           «Оплата подтверждена, товар ожидает синхронизации»
        //           (ack НЕ уходит, «товар получен» НЕ показываем).
        // P1-1 (независимый review): r.ok означает «синк прошёл», а не
        // «грант ЭТОГО chargeId применён» (unknown-product пишется paid
        // без гранта; платёж могли вернуть между verify и синком).
        // Тост и ack — только если chargeId есть в серверном ledger.
        if (provider.id === 'telegram-stars') {
          const tg = provider as TelegramStarsPaymentProvider;
          const r = await tg.syncWalletAndDrainPending();
          const chargeId = (result.chargeId ?? '').trim();
          const materialized =
            r.ok && !!chargeId && r.applied.grantChargeIds.includes(chargeId);
          if (materialized) {
            tg.acknowledgeCharge(result.chargeId);
          } else {
            if (chargeId) enqueuePendingWalletSync({ chargeId, productId: product.id });
            const syncError = r.ok ? 'not-materialized' : r.error;
            // CR-R3-10: syncPending — UI-состояние: в чужом поколении не
            // ставим (баннер новой генерации и так покажет очередь через
            // getPendingSyncChargeIds). Очередь выше — бухгалтерия, остаётся.
            if (gen === this.generation) {
              this.syncPending = {
                productId: product.id,
                productTitle: product.title,
                chargeId,
                error: syncError,
              };
            }
            void trackProductEvent('purchase_sync_pending', PlatformBridge, {
              productId: product.id,
              provider: provider.id,
              error: syncError,
            });
          }
        }
        // Достижения проверяем независимо от исхода синка: звёзды реально
        // списаны (оплату подтвердил сервер), товар не потерян — он встанет
        // из pending-sync дрэйном. Игрок получает награду (напр. скин
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
    // CR-R3-10: чужое поколение (рестарт при resize) — бухгалтерия выше
    // доработана, UI новой генерации не трогаем: ни тосты, ни setState,
    // ни purchasingId/lastBought. Кнопки обновит finally buy().
    if (gen !== this.generation) return;
    // E3: тосты — только после проверки isActive (Phaser-объекты сцены).
    for (const t of pendingToasts) {
      if (t.skinId) showSkinGrantToast(this, t.skinId);
      else showMetaToast(this, t.title, t.sub);
    }
    this.purchasingId = null;
    if (result.state === 'paid' && !grantFailed) {
      if (this.syncPending) {
        // Патч №16 (A3): оплата подтверждена, грант не материализован —
        // различимый статус + баннер с «Повторить» (не «товар получен»).
        this.setState('sync-pending');
      } else {
        this.lastBought = product;
        this.setState('success');
      }
    } else if (result.state === 'paid') {
      // Платёж подтверждён сервером, но выдача не удалась (ok=false):
      // товар не потерян — допроверка и повторная выдача в restore().
      this.errorReason = 'Не удалось выдать товар — проверьте оплату позже';
      this.setState('error');
    } else if (result.state === 'pending') {
      // Баннер «Ожидание подтверждения» рисуется в renderList.
      this.setState('ready');
    } else {
      this.errorReason = purchaseFailureMessage(result);
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
    const check = addUiIcon(this, 0, 0, 'check', 'host').setDisplaySize(46, 46);
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
    // P1-4: подзаголовок — ниже измеренного заголовка (у пропуска заголовок
    // в две строки, фиксированный y=108 наезжал на вторую строку).
    const sub = this.add
      .text(0, 78 + label.height + 8, 'Выдано. Приятной мутации!', {
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
