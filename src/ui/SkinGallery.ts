/**
 * SkinGallery — галерея скинов-штаммов (Фаза 5, DiceBear).
 *
 * Следует конвенциям проекта: токены (ROLE/PANEL/BORDER/VISUAL_TEXT),
 * .setResolution(2) на текстах, destroy при закрытии.
 *
 * Порт-адаптации (main):
 * - БЕЗ Juice (партия 4): анимация открытия — обычные твины сцены
 *   (fade+scale, как у LabOverlays), а не Juice.rewardReveal.
 * - БЕЗ витрины (партия 3): шоп-скины без собственности показывают цену и
 *   «СКОРО»; кнопка «КУПИТЬ» и переход в Storefront появятся, когда партия 3
 *   принесёт shop/Storefront + isStorefrontVisible (см. TODO ниже).
 *   Проводка purchase→grant (grantSkin(id, 'purchase')) — тоже партия 3:
 *   в main ей пока негде жить, шов НЕ выдуман.
 * - Возвращает идемпотентный { close } (как showLabPanel) для Escape и
 *   SHUTDOWN в MenuScene; null, если сцена неактивна.
 * - Гейтится флагом skins.gallery снаружи (MenuScene).
 */
import Phaser from 'phaser';
import { FONT } from '../game/config';
import { BORDER, PANEL, ROLE, TOUCH } from './tokens';
import { VISUAL_TEXT } from './visualTokens';
import { PlatformBridge } from '../platform';
import { Sfx } from '../systems/Sfx';
import {
  DEFAULT_SKIN_ID,
  RARITY_LABEL,
  SkinDef,
  getSkinDef,
  getSkinPriceStars,
  listSkins,
  skinTextureKey,
} from '../game/skins/SkinCatalog';
import { ensureSkinTexture } from '../game/skins/SkinArt';
import { equipSkin, getEquippedSkinId, isSkinOwned } from '../game/skins/SkinOwnership';
import { FeatureFlags } from '../game/FeatureFlags';
import { isStorefrontVisible } from '../game/shop/Storefront';
import { ScrollViewport } from './ScrollViewport';
import type { MenuKeyboard, MenuKeyboardControl, MenuKeyboardScope } from './MenuKeyboard';
import { addUiIcon } from './uiIcons';

const RARITY_COLOR: Record<string, string> = {
  common: '#9fb4c8',
  rare: '#5fd6ff',
  legendary: '#ffd56a',
};

function dimBackground(scene: Phaser.Scene, depth: number): Phaser.GameObjects.Rectangle {
  const W = scene.scale.width;
  const H = scene.scale.height;
  return scene.add
    .rectangle(W / 2, H / 2, W, H, 0x060a10, 0.78)
    .setDepth(depth)
    .setScrollFactor(0)
    .setInteractive();
}

function closeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  depth: number,
  onClose: () => void
): { icon: Phaser.GameObjects.Image; hit: Phaser.GameObjects.Rectangle; activate: () => void } {
  const icon = addUiIcon(scene, x, y, 'close')
    .setDisplaySize(20, 20)
    .setDepth(depth);
  const hit = scene.add.rectangle(x, y, TOUCH.min, TOUCH.min, 0x000000, 0.001)
    .setDepth(depth)
    .setName('ofeliya-skin-gallery-close-hit')
    .setInteractive({ useHandCursor: true });
  const activate = () => {
    Sfx.play('click');
    onClose();
  };
  hit.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    if (!pointer?.wasCanceled) activate();
  });
  return { icon, hit, activate };
}

/** Кнопка-карточка: прямоугольник + подпись, паттерн чипов меню. */
function cardButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  depth: number,
  accent: number,
  onTap: () => void
): Phaser.GameObjects.Container {
  const c = scene.add.container(x, y).setDepth(depth);
  const bg = scene.add
    .rectangle(0, 0, w, h, ROLE.surface.panel, PANEL.button)
    .setStrokeStyle(BORDER.thin, accent, 0.8)
    .setInteractive({ useHandCursor: true });
  const t = scene.add
    .text(0, 0, label, {
      fontFamily: FONT,
      fontSize: '12px',
      fontStyle: 'bold',
      color: VISUAL_TEXT.ivory,
      letterSpacing: 1,
    })
    .setOrigin(0.5)
    .setResolution(2);
  c.add([bg, t]);
  bg.on('pointerdown', () => bg.setAlpha(0.6));
  bg.on('pointerup', (pointer: Phaser.Input.Pointer) => {
    bg.setAlpha(1);
    if (pointer?.wasCanceled) return;
    Sfx.play('click');
    PlatformBridge.haptic('light');
    onTap();
  });
  bg.on('pointerout', () => bg.setAlpha(1));
  return c;
}

/**
 * Галерея скинов: превью (запечённые DiceBear-текстуры), владение,
 * кнопки «Выбрать» / «Купить» (купить → витрина, партия 3).
 */
export function showSkinGallery(
  scene: Phaser.Scene,
  onClose: () => void,
  keyboard?: MenuKeyboard
): { close: () => void } | null {
  if (!scene || !scene.scene.isActive()) return null;
  const W = scene.scale.width;
  const H = scene.scale.height;
  const depth = 60;

  const root = scene.add.container(0, 0).setDepth(depth).setScrollFactor(0);
  const add = (o: Phaser.GameObjects.GameObject) => {
    root.add(o);
    return o;
  };

  let closed = false;
  let viewport: ScrollViewport | null = null;
  let loadingFocus: MenuKeyboardScope | null = null;
  const doClose = () => {
    if (closed) return;
    closed = true;
    loadingFocus?.destroy();
    loadingFocus = null;
    viewport?.destroy();
    viewport = null;
    if (content) scene.tweens.killTweensOf(content);
    root.destroy();
    onClose();
  };

  add(dimBackground(scene, 0));
  // Пост-ревью (патч №11): контент перерисовывается отдельно от root —
  // выбор скина больше не уничтожает и не пересоздаёт всю галерею
  // (и не проигрывает заново анимацию открытия).
  let content: Phaser.GameObjects.Container | null = null;
  const renderContent = (animate: boolean) => {
    loadingFocus?.destroy();
    loadingFocus = null;
    viewport?.destroy();
    viewport = null;
    if (content) scene.tweens.killTweensOf(content);
    content?.destroy();
    content = scene.add.container(0, 0);
    root.add(content);
    const cadd = (o: Phaser.GameObjects.GameObject) => {
      content!.add(o);
      return o;
    };
    const cx = W / 2;
    const cy = H / 2;
    const panelW = Math.min(W - 32, 400);
    const panelH = Math.min(H - 110, 560);
    const panel = scene.add
      .rectangle(cx, cy, panelW, panelH, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, ROLE.faction.reward, 0.6);
    cadd(panel);
    const close = closeButton(scene, cx + panelW / 2 - TOUCH.min / 2, cy - panelH / 2 + 30, 1, doClose);
    cadd(close.icon);
    cadd(close.hit);
    // This fixed header target has no scroll id: focusing it must not move the grid.
    const closeFocus: MenuKeyboardControl = {
      object: close.hit, label: () => '\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0448\u0442\u0430\u043c\u043c\u044b', activate: close.activate,
    };
    loadingFocus = keyboard?.createScope({ escape: () => { doClose(); return true; } }) ?? null;
    loadingFocus?.setControls([closeFocus]);

    const title = scene.add
      .text(cx, cy - panelH / 2 + 30, 'ШТАММЫ', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        letterSpacing: 2,
      })
      .setOrigin(0.5)
      .setResolution(2);
    cadd(title);
    const sub = scene.add
      .text(cx, cy - panelH / 2 + 54, 'Облик вируса. Чистая косметика.', {
        fontFamily: FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0.5)
      .setResolution(2);
    cadd(sub);

    const loading = scene.add
      .text(cx, cy, 'Выращиваем штаммы…', {
        fontFamily: FONT,
        fontSize: '13px',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0.5)
      .setResolution(2);
    cadd(loading);

    const build = () => {
      const contentRoot = content;
      if (!contentRoot) return;
      loading.destroy();
      const skins = listSkins();
      const equippedId = getEquippedSkinId();
      const cols = 2;
      const pad = 14;
      const cardW = (panelW - pad * (cols + 1)) / cols;
      const cardH = 196;
      const gridTop = cy - panelH / 2 + 84;
      const grid = scene.add.container(0, 0).setName('ofeliya-skin-gallery-grid');
      contentRoot.add(grid);
      const focusTargets: MenuKeyboardControl[] = [closeFocus];
      // Витрина портирована (партия 3): шоп-скины показывают цену и кнопку
      // «КУПИТЬ» только когда витрина видима по флагу storefront.variant;
      // при дефолтном 'hidden' — «СКОРО», как раньше.
      const shopVisible = isStorefrontVisible(FeatureFlags.get('storefront.variant'));

      skins.forEach((def, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = cx - panelW / 2 + pad + cardW / 2 + col * (cardW + pad);
        const y = gridTop + cardH / 2 + row * (cardH + pad);
        const owned = isSkinOwned(def.id);
        const equipped = equippedId === def.id;
        const card = scene.add.container(x, y).setName(`ofeliya-skin-gallery-${def.id}`);
        grid.add(card);

        const bg = scene.add
          .rectangle(0, 0, cardW, cardH, ROLE.surface.panel, PANEL.button)
          .setStrokeStyle(
            BORDER.thin,
            equipped ? 0xffd56a : owned ? 0x5fd6ff : ROLE.faction.neutral,
            equipped || owned ? 0.9 : 0.4
          );
        card.add(bg);

        const texKey = def.id === DEFAULT_SKIN_ID ? 'virus-player' : skinTextureKey(def.id);
        const preview = scene.add.image(0, -58, texKey);
        // Превью 64 логических px: делим на bake-фактор текстуры.
        const tw = scene.textures.get(texKey).getSourceImage() as { width: number };
        preview.setScale(64 / tw.width);
        card.add(preview);

        const name = scene.add
          .text(0, 2, def.title, {
            fontFamily: FONT,
            fontSize: '12px',
            fontStyle: 'bold',
            color: VISUAL_TEXT.ivory,
            align: 'center',
            wordWrap: { width: cardW - 16 },
          })
          .setOrigin(0.5, 0)
          .setResolution(2);
        card.add(name);

        const rarity = scene.add
          .text(0, 40, RARITY_LABEL[def.rarity], {
            fontFamily: FONT,
            fontSize: '10px',
            fontStyle: 'bold',
            color: RARITY_COLOR[def.rarity] ?? VISUAL_TEXT.muted,
            letterSpacing: 1,
          })
          .setOrigin(0.5, 0)
          .setResolution(2);
        card.add(rarity);

        if (equipped) {
          const badge = scene.add
            .text(0, 62, 'ВЫБРАН', {
              fontFamily: FONT,
              fontSize: '11px',
              fontStyle: 'bold',
              color: '#ffd56a',
              letterSpacing: 1,
            })
            .setOrigin(0.5, 0)
            .setResolution(2);
          card.add(badge);
        } else if (owned) {
          const select = (): void => {
            if (equipSkin(def.id)) renderContent(false);
          };
          const btn = cardButton(scene, 0, 76, cardW - 24, 28, 'ВЫБРАТЬ', 0, 0x5fd6ff, select);
          card.add(btn);
          focusTargets.push({
            id: def.id,
            object: btn.getAt(0) as Phaser.GameObjects.Rectangle,
            label: () => `${def.title}. Выбрать`,
            activate: select,
          });
        } else {
          const stars = getSkinPriceStars(def.id);
          const price = scene.add
            .text(0, 58, stars !== null ? `${stars} ★` : '—', {
              fontFamily: FONT,
              fontSize: '12px',
              fontStyle: 'bold',
              color: VISUAL_TEXT.ivory,
            })
            .setOrigin(0.5, 0)
            .setResolution(2);
          card.add(price);
          if (shopVisible) {
            const buy = (): void => {
              doClose();
              scene.scene.start('Storefront');
            };
            const btn = cardButton(scene, 0, 80, cardW - 24, 26, 'КУПИТЬ', 0, ROLE.faction.reward, buy);
            card.add(btn);
            focusTargets.push({
              id: def.id,
              object: btn.getAt(0) as Phaser.GameObjects.Rectangle,
              label: () => `${def.title}. Купить`,
              activate: buy,
            });
          } else {
            const soon = scene.add
              .text(0, 78, 'СКОРО', {
                fontFamily: FONT,
                fontSize: '11px',
                color: VISUAL_TEXT.muted,
                letterSpacing: 1,
              })
              .setOrigin(0.5, 0)
              .setResolution(2);
            card.add(soon);
          }
        }
      });
      const rows = Math.ceil(skins.length / cols);
      loadingFocus?.destroy();
      loadingFocus = null;
      viewport = new ScrollViewport(scene, {
        parent: contentRoot,
        content: grid,
        bounds: {
          x: cx - panelW / 2 + pad / 2,
          y: gridTop,
          width: panelW - pad,
          height: Math.max(44, cy + panelH / 2 - gridTop - 12),
        },
        contentHeight: gridTop + rows * cardH + Math.max(0, rows - 1) * pad,
        name: 'ofeliya-skin-gallery',
        keyboard,
        escape: () => { doClose(); return true; },
      });
      viewport.setFocusTargets(focusTargets);
    };

    // Запекаем превью (кэш текстур — повторный вход мгновенный), затем строим сетку.
    const defs = listSkins().filter((d) => d.id !== DEFAULT_SKIN_ID);
    const owner = content;
    const bakeAndBuild = () => {
      Promise.all(defs.map((d) => ensureSkinTexture(scene, d)))
        .then(() => {
          if (closed || !scene.scene.isActive() || content !== owner) return;
          build();
        })
        .catch(() => {
          if (closed || !scene.scene.isActive() || content !== owner) return;
          build();
        });
    };
    bakeAndBuild();
    if (animate) {
      // Без Juice (партия 4): вход — fade+scale обычными твинами сцены.
      content.setAlpha(0);
      content.setScale(0.94);
      scene.tweens.add({ targets: content, alpha: 1, duration: 200 });
      scene.tweens.add({ targets: content, scale: 1, duration: 300, ease: 'Back.easeOut' });
    }
  };

  renderContent(true);
  return { close: doClose };
}

/**
 * Тост выдачи скина (награды достижений/квестов): превью штамма +
 * анимация появления (без Juice — твины сцены).
 */
export function showSkinGrantToast(scene: Phaser.Scene, skinId: string): void {
  if (!scene || !scene.scene.isActive()) return;
  const def: SkinDef | undefined = getSkinDef(skinId);
  if (!def) return;
  const W = scene.scale.width;
  const H = scene.scale.height;

  const render = () => {
    const c = scene.add
      .container(W / 2, Math.max(120, H * 0.2))
      .setScrollFactor(0)
      .setDepth(62);
    const panelW = Math.min(W - 36, 340);
    const bg = scene.add
      .rectangle(0, 0, panelW, 120, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, 0xffd56a, 0.9);
    const texKey = def.id === DEFAULT_SKIN_ID ? 'virus-player' : skinTextureKey(def.id);
    const img = scene.add.image(-panelW / 2 + 56, 0, texKey);
    const tw = scene.textures.get(texKey).getSourceImage() as { width: number };
    img.setScale(72 / tw.width);
    const title = scene.add
      .text(-panelW / 2 + 104, -26, 'Новый штамм!', {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffd56a',
      })
      .setOrigin(0, 0.5)
      .setResolution(2);
    const name = scene.add
      .text(-panelW / 2 + 104, 8, def.title, {
        fontFamily: FONT,
        fontSize: '12px',
        color: VISUAL_TEXT.ivory,
        wordWrap: { width: panelW - 120 },
      })
      .setOrigin(0, 0.5)
      .setResolution(2);
    const hint = scene.add
      .text(-panelW / 2 + 104, 36, 'Выбрать — в меню «Штаммы»', {
        fontFamily: FONT,
        fontSize: '10px',
        color: VISUAL_TEXT.muted,
      })
      .setOrigin(0, 0.5)
      .setResolution(2);
    c.add([bg, img, title, name, hint]);
    c.setAlpha(0);
    c.setScale(0.94);
    scene.tweens.add({ targets: c, alpha: 1, duration: 200 });
    scene.tweens.add({ targets: c, scale: 1, duration: 430, ease: 'Back.easeOut' });
    scene.tweens.add({
      targets: c,
      alpha: 0,
      duration: 350,
      delay: 2200,
      onComplete: () => c.destroy(),
    });
  };

  if (def.id === DEFAULT_SKIN_ID) render();
  else
    ensureSkinTexture(scene, def)
      .then(() => {
        if (scene.scene.isActive()) render();
      })
      .catch(() => {
        if (scene.scene.isActive()) render();
      });
}
