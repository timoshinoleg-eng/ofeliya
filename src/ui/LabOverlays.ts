/**
 * LabOverlays — UI «лаборатории мутаций» (Фаза 4).
 *
 * Порт Фазы 4 (адаптация под main):
 * - БЕЗ Juice (Juice — партия 4, не трогать): вход панели — fade-in +
 *   лёгкий scale твинами сцены (паттерн модалки Фазы 3); при покупке —
 *   punch scale на лейбле эффекта; reduced motion учитывается.
 * - WebAnalytics.track → trackProductEvent (ProductEvent, PlatformBridge).
 * - Суммы — plain numbers: canAfford — обычное сравнение чисел.
 * - Литералы «RNA» → «РНК» (канон UI: check-language-copy запрещает
 *   player-facing «RNA»).
 *
 * Следует конвенциям проекта: токены (ROLE/PANEL/BORDER/VISUAL_TEXT),
 * .setResolution(2) на текстах, чистые отписки (destroy on close).
 * Отдельный модуль (не раздуваем MenuScene): билдеры принимают scene.
 * Гейтится флагом economy.lab снаружи (точка входа — см. PR).
 */
import Phaser from 'phaser';
import { FONT } from '../game/config';
import { BORDER, PANEL, ROLE } from './tokens';
import { VISUAL_TEXT } from './visualTokens';
import { PlatformBridge } from '../platform';
import { Sfx } from '../systems/Sfx';
import { prefersReducedMotion } from '../systems/MotionPreferences';
import { trackProductEvent } from '../systems/AnalyticsClient';
import { loadMeta } from '../game/meta/MetaWallet';
import {
  LAB_BRANCHES,
  costForLevel,
  effectText,
  formatRna,
  prestigeBonus,
  type LabBranch,
} from '../game/lab/LabBranches';
import {
  PRESTIGE_MIN_LEVELS,
  buyLabUpgrade,
  doPrestige,
  getBranchLevel,
  loadLabState,
  totalLevels,
} from '../game/lab/LabState';
import { showMetaToast } from './RetentionOverlays';

const DEPTH = 60;

function dimBackground(scene: Phaser.Scene): Phaser.GameObjects.Rectangle {
  const W = scene.scale.width;
  const H = scene.scale.height;
  return scene.add
    .rectangle(W / 2, H / 2, W, H, 0x060a10, 0.72)
    .setDepth(DEPTH)
    .setScrollFactor(0)
    .setInteractive();
}

function closeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  onClose: () => void
): Phaser.GameObjects.Text {
  const btn = scene.add
    .text(x, y, '✕', {
      fontFamily: FONT,
      fontSize: '18px',
      color: VISUAL_TEXT.ivory,
    })
    .setOrigin(0.5)
    .setResolution(2)
    .setDepth(DEPTH + 2)
    .setInteractive({ useHandCursor: true });
  btn.on('pointerup', () => {
    Sfx.play('click');
    onClose();
  });
  return btn;
}

/**
 * Панель лаборатории: 3 ветки апгрейдов + блок престижа.
 * Перерисовывается после каждой покупки/сброса (render()).
 */
export function showLabPanel(scene: Phaser.Scene, onClose: () => void): void {
  if (!scene || !scene.scene.isActive()) return;
  const W = scene.scale.width;
  const H = scene.scale.height;

  const root = scene.add.container(0, 0).setDepth(DEPTH).setScrollFactor(0);
  const dim = dimBackground(scene);
  root.add(dim);

  const panelW = Math.min(W - 48, 360);
  const rowH = 108;
  const prestigeH = 118;
  const panelH = 92 + LAB_BRANCHES.length * rowH + prestigeH + 12;
  const cx = W / 2;
  const cy = H / 2;

  const panel = scene.add
    .rectangle(cx, cy, panelW, panelH, ROLE.surface.panel, PANEL.card)
    .setStrokeStyle(BORDER.thin, ROLE.faction.reward, 0.6);
  root.add(panel);

  const headerY = cy - panelH / 2 + 26;
  root.add(
    scene.add
      .text(cx, headerY, 'ЛАБОРАТОРИЯ МУТАЦИЙ', {
        fontFamily: FONT,
        fontSize: '14px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setResolution(2)
  );
  const balanceText = scene.add
    .text(cx, headerY + 20, '', {
      fontFamily: FONT,
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#ffe066',
    })
    .setOrigin(0.5)
    .setResolution(2);
  root.add(balanceText);
  root.add(closeButton(scene, cx + panelW / 2 - 20, headerY, destroy));

  // Контент перерисовывается: ветки + престиж.
  const content = scene.add.container(0, 0);
  root.add(content);

  function destroy(): void {
    root.destroy();
    onClose();
  }
  dim.on('pointerup', destroy);

  function render(): void {
    content.removeAll(true);
    const st = loadLabState();
    balanceText.setText(`${formatRna(loadMeta().rna)} РНК`);

    LAB_BRANCHES.forEach((branch, i) => {
      const level = getBranchLevel(st, branch.id);
      const y = cy - panelH / 2 + 92 + i * rowH + rowH / 2;
      const left = cx - panelW / 2 + 16;
      const rowW = panelW - 32;
      const maxed = level >= branch.maxLevel;

      content.add(
        scene.add
          .text(left, y - 38, `${branch.title}  ·  ${level}/${branch.maxLevel}`, {
            fontFamily: FONT,
            fontSize: '13px',
            fontStyle: 'bold',
            color: maxed ? '#7fffa1' : VISUAL_TEXT.ivory,
          })
          .setResolution(2)
      );
      content.add(
        scene.add
          .text(left, y - 18, branch.description, {
            fontFamily: FONT,
            fontSize: '11px',
            color: VISUAL_TEXT.muted,
            wordWrap: { width: rowW - 120 },
          })
          .setResolution(2)
      );
      const effectLabel = scene.add
        .text(left, y + 6, effectText(branch, level), {
          fontFamily: FONT,
          fontSize: '11px',
          fontStyle: 'bold',
          color: '#7fd4ff',
        })
        .setResolution(2);
      content.add(effectLabel);

      // Кнопка покупки.
      const btnW = 108;
      const btnH = 36;
      const btnX = cx + panelW / 2 - 16 - btnW / 2;
      const btnY = y + 2;
      const affordable = maxed || canAfford(branch, level);
      const btn = scene.add
        .rectangle(btnX, btnY, btnW, btnH, ROLE.surface.panel, PANEL.button)
        .setStrokeStyle(BORDER.thin, ROLE.faction.reward, maxed ? 0.35 : 0.75)
        .setAlpha(maxed || !affordable ? 0.45 : 1)
        .setInteractive({ useHandCursor: true });
      const btnLabel = scene.add
        .text(btnX, btnY, maxed ? 'МАКС' : `${formatRna(costForLevel(branch, level))} РНК`, {
          fontFamily: FONT,
          fontSize: '11px',
          fontStyle: 'bold',
          color: maxed ? VISUAL_TEXT.muted : VISUAL_TEXT.ivory,
        })
        .setOrigin(0.5)
        .setResolution(2);
      content.add(btn);
      content.add(btnLabel);

      if (!maxed) {
        btn.on('pointerdown', () => btn.setAlpha(0.6));
        btn.on('pointerout', () => btn.setAlpha(affordable ? 1 : 0.45));
        btn.on('pointerup', () => {
          btn.setAlpha(affordable ? 1 : 0.45);
          if (!affordable) return; // недостаточно RNA — кнопка приглушена
          const res = buyLabUpgrade(branch.id);
          if (!res.ok) {
            render();
            return;
          }
          Sfx.play('levelup');
          PlatformBridge.haptic('light');
          void trackProductEvent('lab_upgrade_bought', PlatformBridge, {
            branchId: branch.id,
            level: res.level ?? 0,
          });
          render();
          // Punch на лейбле эффекта (вместо Juice.rewardReveal).
          if (!prefersReducedMotion()) {
            scene.tweens.add({
              targets: effectLabel,
              scale: { from: 1.18, to: 1 },
              duration: 220,
              ease: 'Back.easeOut',
            });
          }
          showMetaToast(scene, branch.title, `Уровень ${res.level} · ${effectText(branch, res.level ?? 0)}`);
        });
      }
    });

    renderPrestige(content, cx, cy, panelW, panelH, render, destroy);
  }

  function canAfford(branch: LabBranch, level: number): boolean {
    return costForLevel(branch, level) <= loadMeta().rna;
  }

  render();
  // Вход панели: fade-in + лёгкий scale (вместо Juice.rewardReveal).
  if (!prefersReducedMotion()) {
    root.setAlpha(0);
    panel.setScale(0.97);
    scene.tweens.add({ targets: root, alpha: 1, duration: 160 });
    scene.tweens.add({ targets: panel, scale: 1, duration: 200, ease: 'Back.easeOut' });
  }
}

/** Блок престижа внизу панели + диалог подтверждения. */
function renderPrestige(
  content: Phaser.GameObjects.Container,
  cx: number,
  cy: number,
  panelW: number,
  panelH: number,
  render: () => void,
  destroy: () => void
): void {
  const scene = content.scene;
  const st = loadLabState();
  const top = cy + panelH / 2 - 118;
  const left = cx - panelW / 2 + 16;

  content.add(
    scene.add
      .text(left, top, `ПРЕСТИЖ ×${st.prestigeCount}`, {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
      })
      .setResolution(2)
  );
  content.add(
    scene.add
      .text(left, top + 20, `Бонус: +${st.prestigeCount * 10}% к доходу РНК`, {
        fontFamily: FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
      })
      .setResolution(2)
  );
  content.add(
    scene.add
      .text(left, top + 36, 'Сброс уровней и запаса РНК ради постоянного бонуса.', {
        fontFamily: FONT,
        fontSize: '11px',
        color: VISUAL_TEXT.muted,
        wordWrap: { width: panelW - 32 },
      })
      .setResolution(2)
  );

  const canPrestige = totalLevels(st) >= PRESTIGE_MIN_LEVELS;
  const btnW = 150;
  const btnH = 34;
  const btnX = cx;
  const btnY = top + 84;
  const btn = scene.add
    .rectangle(btnX, btnY, btnW, btnH, ROLE.surface.panel, PANEL.button)
    .setStrokeStyle(BORDER.thin, 0xff8a8a, canPrestige ? 0.8 : 0.3)
    .setAlpha(canPrestige ? 1 : 0.4)
    .setInteractive({ useHandCursor: true });
  const label = scene.add
    .text(btnX, btnY, 'СБРОСИТЬ (ПРЕСТИЖ)', {
      fontFamily: FONT,
      fontSize: '11px',
      fontStyle: 'bold',
      color: canPrestige ? '#ffb3b3' : VISUAL_TEXT.muted,
    })
    .setOrigin(0.5)
    .setResolution(2);
  content.add(btn);
  content.add(label);

  if (canPrestige) {
    btn.on('pointerup', () => {
      Sfx.play('click');
      showPrestigeConfirm(scene, render, destroy);
    });
  }
}

/** Диалог подтверждения престижа: явное согласие на сброс. */
function showPrestigeConfirm(
  scene: Phaser.Scene,
  render: () => void,
  closePanel: () => void
): void {
  const st = loadLabState();
  const nextBonus = prestigeBonus(st.prestigeCount + 1);
  const W = scene.scale.width;
  const H = scene.scale.height;

  const root = scene.add.container(0, 0).setDepth(DEPTH + 10).setScrollFactor(0);
  root.add(
    scene.add.rectangle(W / 2, H / 2, W, H, 0x060a10, 0.8).setInteractive()
  );
  const panelW = Math.min(W - 64, 320);
  const panelH = 210;
  const cx = W / 2;
  const cy = H / 2;
  root.add(
    scene.add
      .rectangle(cx, cy, panelW, panelH, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, 0xff8a8a, 0.8)
  );
  root.add(
    scene.add
      .text(cx, cy - 72, 'ТОЧНО СБРОСИТЬ?', {
        fontFamily: FONT,
        fontSize: '14px',
        fontStyle: 'bold',
        color: '#ffb3b3',
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setResolution(2)
  );
  root.add(
    scene.add
      .text(
        cx,
        cy - 30,
        'Уровни лаборатории и весь запас РНК обнулятся. ' +
          `Бонус престижа станет +${(st.prestigeCount + 1) * 10}% к доходу РНК.`,
        {
          fontFamily: FONT,
          fontSize: '12px',
          color: VISUAL_TEXT.ivory,
          align: 'center',
          wordWrap: { width: panelW - 40 },
        }
      )
      .setOrigin(0.5, 0)
      .setResolution(2)
  );

  const mkBtn = (x: number, labelText: string, danger: boolean, onTap: () => void) => {
    const b = scene.add
      .rectangle(x, cy + 72, 128, 38, ROLE.surface.panel, PANEL.button)
      .setStrokeStyle(BORDER.thin, danger ? 0xff8a8a : ROLE.faction.reward, 0.8)
      .setInteractive({ useHandCursor: true });
    const t = scene.add
      .text(x, cy + 72, labelText, {
        fontFamily: FONT,
        fontSize: '12px',
        fontStyle: 'bold',
        color: danger ? '#ffb3b3' : VISUAL_TEXT.ivory,
      })
      .setOrigin(0.5)
      .setResolution(2);
    b.on('pointerup', () => {
      Sfx.play('click');
      onTap();
    });
    root.add(b);
    root.add(t);
  };

  mkBtn(cx - 72, 'ОТМЕНА', false, () => root.destroy());
  mkBtn(cx + 72, 'СБРОСИТЬ', true, () => {
    const res = doPrestige();
    root.destroy();
    if (!res.ok) return;
    Sfx.play('levelup');
    PlatformBridge.haptic('medium');
    void trackProductEvent('prestige_done', PlatformBridge, {
      count: (res.previousCount ?? 0) + 1,
      bonus: res.newBonus ?? nextBonus,
    });
    showMetaToast(scene, 'ПРЕСТИЖ', `Бонус +${((res.previousCount ?? 0) + 1) * 10}% к доходу РНК`);
    render();
  });
}
