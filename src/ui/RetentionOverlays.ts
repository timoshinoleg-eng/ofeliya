/**
 * RetentionOverlays — UI retention-слоя Фазы 3 (daily-календарь, тосты).
 *
 * Порт Фазы 3 (адаптация под main):
 * - showQuestPanel НЕ портируется: в main панель квестов уже есть
 *   (src/ui/QuestBoard.ts, открывается из меню «ЗАДАНИЯ»), а inkjs-движок
 *   квестов заменён src/quests/ (те же 12 квестов, без inkjs).
 * - showDailyModal — переписан под серверный daily (см. DailyCalendar):
 *   claim только после сыгранного забега дня; три состояния кнопки
 *   (ЗАБРАТЬ / УЖЕ ЗАБРАНО / СЫГРАТЬ ЗАБЕГ ДНЯ).
 * - Аналитика — через trackProductEvent (WebAnalytics стека в main нет).
 * - Грант daily-награды — внутри claimDaily (единственная точка минта);
 *   модалка только показывает результат и проверяет streak-достижения.
 *
 * Отличие от стека: кнопка ✕ есть во всех состояниях модалки (в стеке
 * в состоянии «можно забрать» закрыть было нельзя). Модалка показывается
 * автоматически при каждом входе в меню, пока награда не забрана, —
 * закрытие ничему не вредит, а игроку не блокирует меню.
 * Закрытие по тапу на затемнение — нет (как в стеке), только ✕.
 *
 * Следует конвенциям проекта: токены (ROLE/PANEL/BORDER/VISUAL_TEXT),
 * .setResolution(2) на текстах, чистые отписки (destroy on close),
 * reduced motion — без сдвига тоста.
 * Отдельный модуль (не раздуваем MenuScene): билдеры принимают scene.
 * Всё гейтится флагом retention.quests снаружи (MenuScene).
 */
import Phaser from 'phaser';
import { FONT } from '../game/config';
import { BORDER, PANEL, ROLE } from './tokens';
import { VISUAL_TEXT } from './visualTokens';
import { PlatformBridge } from '../platform';
import { Sfx } from '../systems/Sfx';
import { prefersReducedMotion } from '../systems/MotionPreferences';
import { trackProductEvent } from '../systems/AnalyticsClient';
import {
  DAILY_REWARDS,
  claimDaily,
  getDailyStatus,
  rewardForDayIndex,
} from '../game/daily/DailyCalendar';
import { addRna } from '../game/meta/MetaWallet';
import {
  collectLifetimeStats,
  getMetaAchievementDef,
  grantAchievementSkin,
  unlockMetaAchievements,
} from '../game/achievements/MetaAchievements';

function dimBackground(scene: Phaser.Scene, depth: number): Phaser.GameObjects.Rectangle {
  const W = scene.scale.width;
  const H = scene.scale.height;
  return scene.add
    .rectangle(W / 2, H / 2, W, H, 0x060a10, 0.72)
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
): Phaser.GameObjects.Text {
  const btn = scene.add
    .text(x, y, '✕', {
      fontFamily: FONT,
      fontSize: '18px',
      color: VISUAL_TEXT.ivory,
    })
    .setOrigin(0.5)
    .setResolution(2)
    .setDepth(depth)
    .setInteractive({ useHandCursor: true });
  btn.on('pointerup', () => {
    Sfx.play('click');
    onClose();
  });
  return btn;
}

/**
 * Модалка daily-календаря. Показывается из MenuScene когда
 * getDailyStatus().canClaim (сыгран забег дня, награда не забрана).
 * onClaimed вызывается после успешного claim (для аналитики/тостов снаружи).
 * onPlayDaily — для состояния «сегодня не сыграно»: запускает забег дня.
 */
export function showDailyModal(
  scene: Phaser.Scene,
  onClaimed: (streak: number, rewardRna: number) => void,
  onPlayDaily?: () => void
): void {
  if (!scene || !scene.scene.isActive()) return;
  const W = scene.scale.width;
  const H = scene.scale.height;
  const depth = 61;
  const root = scene.add.container(0, 0).setDepth(depth).setScrollFactor(0);
  const add = <T extends Phaser.GameObjects.GameObject>(obj: T): T => {
    root.add(obj);
    return obj;
  };
  add(dimBackground(scene, 0));

  const status = getDailyStatus();
  const panelW = Math.min(W - 48, 360);
  const panelH = 300;
  const cx = W / 2;
  const cy = H / 2;
  add(
    scene.add
      .rectangle(cx, cy, panelW, panelH, ROLE.surface.panel, PANEL.card)
      .setStrokeStyle(BORDER.thin, ROLE.faction.reward, 0.6)
  );
  add(
    scene.add
      .text(cx, cy - panelH / 2 + 28, 'ЕЖЕДНЕВНАЯ НАГРАДА', {
        fontFamily: FONT,
        fontSize: '14px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setResolution(2)
  );
  const subtitle = status.claimedToday
    ? `Стрик: ${status.streak} дн. · награда забрана`
    : status.playedToday
      ? `Стрик: ${status.streak} дн.`
      : `Стрик: ${status.streak} дн. · сыграй забег дня`;
  add(
    scene.add
      .text(cx, cy - panelH / 2 + 52, subtitle, {
        fontFamily: FONT,
        fontSize: '12px',
        color: '#ffe066',
      })
      .setOrigin(0.5)
      .setResolution(2)
  );

  // Сетка 7 дней: 4 + 3. Позиция в цикле — cycleIndex; забранные ячейки —
  // дни цикла до сегодняшней (при уже забранной — включая сегодняшнюю).
  const claimedCount = status.claimedToday ? status.cycleIndex + 1 : status.cycleIndex;
  const cellW = 72;
  const cellH = 64;
  const rows = [4, 3];
  let idx = 0;
  rows.forEach((count, r) => {
    const rowW = count * cellW;
    for (let c = 0; c < count; c++, idx++) {
      const reward = rewardForDayIndex(idx);
      const x = cx - rowW / 2 + cellW * (c + 0.5);
      const y = cy - 40 + r * (cellH + 8);
      const isClaimed = idx < claimedCount;
      const isNext = !status.claimedToday && idx === status.cycleIndex;
      add(
        scene.add
          .rectangle(x, y, cellW - 8, cellH, 0x0a0f16, 1)
          .setStrokeStyle(1.5, isNext ? 0xffe066 : isClaimed ? 0x7fffa1 : 0x2a3340, isNext || isClaimed ? 0.9 : 0.5)
      );
      add(
        scene.add
          .text(x, y - 14, `День ${idx + 1}`, {
            fontFamily: FONT,
            fontSize: '10px',
            color: VISUAL_TEXT.muted,
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
      add(
        scene.add
          .text(x, y + 8, isClaimed ? '✓' : `+${reward.rna}`, {
            fontFamily: FONT,
            fontSize: '13px',
            fontStyle: 'bold',
            color: isClaimed ? '#7fffa1' : isNext ? '#ffe066' : VISUAL_TEXT.ivory,
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }
  });

  const btnW = 200;
  const btnH = 44;
  const btnY = cy + panelH / 2 - 40;
  const btnLabelText = status.canClaim
    ? 'ЗАБРАТЬ'
    : status.claimedToday
      ? 'УЖЕ ЗАБРАНО'
      : 'СЫГРАТЬ ЗАБЕГ ДНЯ';
  const btn = add(
    scene.add
      .rectangle(cx, btnY, btnW, btnH, ROLE.surface.panel, PANEL.button)
      .setStrokeStyle(BORDER.thin, ROLE.faction.reward, 0.8)
      .setInteractive({ useHandCursor: true })
  );
  const btnLabel = add(
    scene.add
      .text(cx, btnY, btnLabelText, {
        fontFamily: FONT,
        fontSize: '13px',
        fontStyle: 'bold',
        color: VISUAL_TEXT.ivory,
        letterSpacing: 1,
      })
      .setOrigin(0.5)
      .setResolution(2)
  );
  add(closeButton(scene, cx + panelW / 2 - 20, cy - panelH / 2 + 28, 1, () => root.destroy()));

  if (status.canClaim) {
    btn.on('pointerup', () => {
      const res = claimDaily();
      if (!res.ok) {
        root.destroy();
        return;
      }
      void trackProductEvent('daily_claimed', PlatformBridge, {
        day: res.reward.day,
        streak: res.streak,
        reward: res.reward.rna,
      });
      // Meta-достижения за стрик — сразу, с тостом и аналитикой.
      const fresh = unlockMetaAchievements(collectLifetimeStats());
      Sfx.play('levelup');
      PlatformBridge.haptic('medium');
      btn.disableInteractive();
      btnLabel.setText(`+${res.reward.rna} РНК`);
      // Панч-метка выдачи (в меню нет Juice-пампа — обычный твин сцены).
      scene.tweens.add({
        targets: btnLabel,
        scaleX: 1.3,
        scaleY: 1.3,
        duration: 150,
        yoyo: true,
      });
      scene.tweens.add({
        targets: root,
        alpha: 0,
        duration: 350,
        delay: 650,
        onComplete: () => root.destroy(),
      });
      onClaimed(res.streak, res.reward.rna);
      for (const id of fresh) {
        const def = getMetaAchievementDef(id);
        if (def.reward.kind === 'rna') addRna(def.reward.amount);
        else grantAchievementSkin(def.reward.skinId);
        void trackProductEvent('achievement_unlocked', PlatformBridge, { achievementId: id });
        showMetaToast(
          scene,
          def.title,
          def.reward.kind === 'rna' ? `+${def.reward.amount} РНК` : 'Новый штамм'
        );
      }
    });
  } else if (!status.claimedToday) {
    // Сегодня не сыграно: кнопка ведёт в забег дня (если обработчик дан).
    btn.on('pointerup', () => {
      Sfx.play('click');
      root.destroy();
      onPlayDaily?.();
    });
  }
}

/** Компактный тост (зеркалит паттерн GameScene.showAchievementToast). */
export function showMetaToast(scene: Phaser.Scene, title: string, sub: string): void {
  if (!scene || !scene.scene.isActive()) return;
  const W = scene.scale.width;
  const H = scene.scale.height;
  const c = scene.add.container(W / 2, Math.max(120, H * 0.2)).setScrollFactor(0).setDepth(62).setAlpha(0);
  const panelW = Math.min(W - 36, 340);
  const panel = scene.add
    .rectangle(0, 0, panelW, 52, 0x101522, 0.94)
    .setStrokeStyle(1.5, 0xffd56a, 0.82);
  const header = scene.add
    .text(-panelW / 2 + 14, -16, 'ДОСТИЖЕНИЕ', {
      fontFamily: FONT,
      fontSize: '9px',
      fontStyle: 'bold',
      color: '#ffe066',
    })
    .setResolution(2);
  const name = scene.add
    .text(-panelW / 2 + 14, 0, title, {
      fontFamily: FONT,
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#e8f4ff',
    })
    .setResolution(2);
  const subText = scene.add
    .text(panelW / 2 - 14, 0, sub, {
      fontFamily: FONT,
      fontSize: '12px',
      fontStyle: 'bold',
      color: '#7fffa1',
    })
    .setOrigin(1, 0.5)
    .setResolution(2);
  c.add([panel, header, name, subText]);
  Sfx.play('levelup');
  scene.tweens.add({
    targets: c,
    alpha: 1,
    y: prefersReducedMotion() ? c.y : c.y + 6,
    duration: 160,
    yoyo: true,
    hold: 1100,
    onComplete: () => c.destroy(),
  });
}
