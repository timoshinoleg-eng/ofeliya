import Phaser from 'phaser';
import { QuestRuntime } from '../quests/questRuntime';
import { nextUtcMidnightMs } from '../quests/questRotation';
import {
  claimSeasonMission,
  seasonDisplayName,
  seasonIdFor,
  seasonSnapshot,
  type SeasonMissionProgress,
} from '../game/shop/seasonQuests';
import { SaveSystem } from '../systems/SaveSystem';
import { FONT, UI_FONT } from '../game/config';
import { META_COPY } from '../game/UiCopy';
import { fmtCountdown, fmtProgress } from '../game/UiFormat';
import { VISUAL, VISUAL_TEXT } from './visualTokens';
import { PlatformBridge } from '../platform';
import { createMetaDock, createModalFrame, MODAL, type MetaDockTarget } from './modal';
import { showMetaToast } from './RetentionOverlays';

/**
 * Daily tasks board.
 *
 * Read-only mirror of the quest core: the board never grants anything and never
 * claims a reward. The countdown uses the rotation's own reset semantics — the
 * next UTC midnight — and the reset timing is not touched here.
 *
 * Монетизация v3: ниже дневных — секция сезонных миссий (отдельный модуль
 * seasonQuests, НЕ дневной движок). Секция НЕ read-only: награды сезона —
 * локальные гранты (как Daily/достижения), кнопка «ЗАБРАТЬ» выдаёт их
 * сразу. Дневная часть доски остаётся read-only.
 */
export class QuestBoard {
  private root: Phaser.GameObjects.Container;
  private timer: Phaser.Time.TimerEvent;
  private closed = false;

  constructor(
    private scene: Phaser.Scene,
    private dismissed: () => void,
    private navigate: (target: MetaDockTarget) => void
  ) {
    this.root = scene.add.container(0, 0).setDepth(70).setName('ofeliya-quests');
    const runtime = new QuestRuntime();
    runtime.mirrorLifetime(SaveSystem.get().runs);
    let day = '';
    let countdown = '';
    let progressLine: Phaser.GameObjects.Text | null = null;
    const render = () => {
      // UI only mirrors the product lifetime; it cannot emit gameplay or claim rewards.
      const snapshot = runtime.snapshot();
      const remaining = fmtCountdown(nextUtcMidnightMs(Date.now()) - Date.now());
      const completed = snapshot.progress.filter((p) => p.complete).length;
      if (day === snapshot.dayKey) {
        // Inside a day the board is not rebuilt: the objects under the player's
        // finger stay the same objects. Only the countdown line moves, and it is
        // updated in place — a rebuild would replace the whole board once a
        // minute for a line that only shows the time left.
        if (countdown !== remaining) {
          countdown = remaining;
          progressLine?.setText(
            META_COPY.tasksProgress(completed, snapshot.progress.length, remaining)
          );
        }
        return;
      }
      day = snapshot.dayKey;
      countdown = remaining;
      this.root.removeAll(true);
      const W = scene.scale.width;
      const H = scene.scale.height;
      const w = Math.min(W - 22, 400);
      const h = Math.min(H - 28, 560);
      const left = (W - w) / 2;
      const top = (H - h) / 2;
      const compact = H < 650;

      const dismiss = (): void => this.destroy();
      const frame = createModalFrame(scene, this.root, {
        x: W / 2,
        y: H / 2,
        width: w,
        height: h,
        title: META_COPY.tasks,
        compact,
        withDock: true,
        onClose: dismiss,
      });

      const text = (
        x: number,
        y: number,
        value: string,
        size: number,
        color: string = VISUAL_TEXT.ivory
      ): Phaser.GameObjects.Text => {
        const t = scene.add
          .text(x, y, value, {
            fontFamily: UI_FONT,
            fontSize: size,
            color,
            wordWrap: { width: w - MODAL.padX * 2 },
            lineSpacing: 4,
          })
          .setResolution(2);
        this.root.add(t);
        return t;
      };

      progressLine = text(
        left + MODAL.padX,
        frame.bodyTop,
        META_COPY.tasksProgress(completed, snapshot.progress.length, remaining),
        compact ? 11 : 12,
        VISUAL_TEXT.host
      );

      const dock = createMetaDock(scene, this.root, {
        x: W / 2,
        y: frame.dockTop,
        width: w - MODAL.padX * 2,
        active: 'tasks',
        compact,
        onSelect: (target) => {
          if (target === 'tasks') return;
          this.destroy();
          this.navigate(target);
        },
      });
      dock.setActive('tasks');

      const rowTop = frame.bodyTop + 34;
      // Монетизация v3: секция сезона резервирует место ДО расчёта высоты
      // дневных строк (иначе сезон налез бы на док). Показываем не все 6
      // миссий, а до 3 по приоритету: сначала забрать, потом ближайшие к
      // завершению; после claim перестройка покажет следующие.
      const seasonAll = seasonSnapshot();
      const seasonDone = seasonAll.filter((p) => p.complete).length;
      const seasonRows: SeasonMissionProgress[] = [...seasonAll]
        .sort((a, b) => {
          const rank = (p: SeasonMissionProgress): number =>
            p.claimable ? 0 : !p.complete ? 1 : 2;
          const r = rank(a) - rank(b);
          if (r !== 0) return r;
          const ra = a.def.target > 0 ? a.progress / a.def.target : 0;
          const rb = b.def.target > 0 ? b.progress / b.def.target : 0;
          return rb - ra;
        })
        .slice(0, compact ? 2 : 3);
      const seasonRowH = 42;
      const seasonH = 26 + seasonRows.length * seasonRowH;
      const rowHeight =
        (h - (rowTop - top) - MODAL.dockHeight - 26 - seasonH) /
        Math.max(1, snapshot.progress.length);
      snapshot.progress.forEach((p, i) => {
        const def = runtime.catalog().find((d) => d.id === p.questId);
        if (!def) return;
        const y = rowTop + i * rowHeight;
        const done = p.complete || p.progress >= p.target;
        const current = Math.min(p.progress, p.target);
        const remainingCount = Math.max(0, p.target - p.progress);

        text(left + MODAL.padX, y, def.title, compact ? 13 : 15);
        text(left + MODAL.padX, y + 24, def.desc, compact ? 11 : 12, VISUAL_TEXT.muted);

        // Every quest of the catalog has a numeric target, so the bar is always
        // a real fraction of a real goal.
        const barW = w - MODAL.padX * 2;
        const barY = y + (compact ? 48 : 52);
        const barH = 4;
        const back = scene.add
          .rectangle(left + MODAL.padX + barW / 2, barY, barW, barH, VISUAL.ink, 0.9)
          .setStrokeStyle(1, VISUAL.line, 0.4);
        const ratio = p.target > 0 ? Math.max(0, Math.min(1, current / p.target)) : 0;
        const fill = scene.add
          .rectangle(left + MODAL.padX + (barW * ratio) / 2, barY, Math.max(2, barW * ratio), barH,
            done ? VISUAL.host : VISUAL.player, done ? 1 : 0.85);
        this.root.add([back, fill]);

        text(
          left + MODAL.padX,
          barY + 10,
          done ? META_COPY.taskComplete : `${fmtProgress(current, p.target)} · ${META_COPY.remaining(remainingCount)}`,
          compact ? 11 : 12,
          done ? VISUAL_TEXT.host : VISUAL_TEXT.muted
        );
      });

      // --- Сезонные миссии (монетизация v3) ---
      const seasonTop = rowTop + snapshot.progress.length * rowHeight;
      const seasonTitle = text(
        left + MODAL.padX,
        seasonTop,
        `СЕЗОННЫЕ МИССИИ · ${seasonDisplayName(seasonIdFor(Date.now()))}`,
        compact ? 11 : 12,
        VISUAL_TEXT.host
      );
      void seasonTitle;
      text(
        left + w - MODAL.padX,
        seasonTop,
        `${seasonDone}/${seasonAll.length}`,
        compact ? 11 : 12,
        VISUAL_TEXT.muted
      ).setOrigin(1, 0);

      seasonRows.forEach((p, i) => {
        const y = seasonTop + 26 + i * seasonRowH;
        const title = p.def.track === 'paid' ? `${p.def.title} ★` : p.def.title;
        text(left + MODAL.padX, y, title, compact ? 12 : 13);
        text(left + MODAL.padX, y + 16, p.def.desc, compact ? 10 : 11, VISUAL_TEXT.muted);
        const rightX = left + w - MODAL.padX;
        if (p.claimed) {
          text(rightX, y, 'ЗАБРАНО', 10, VISUAL_TEXT.host).setOrigin(1, 0);
        } else if (p.claimable) {
          const btnW = 84;
          const btnH = 30;
          const btn = scene.add
            .rectangle(rightX - btnW / 2, y + 12, btnW, btnH, VISUAL.player, 0.9)
            .setStrokeStyle(1, VISUAL.player, 1)
            .setInteractive({ useHandCursor: true });
          const label = scene.add
            .text(rightX - btnW / 2, y + 12, 'ЗАБРАТЬ', {
              fontFamily: FONT,
              fontSize: '11px',
              fontStyle: 'bold',
              color: '#0b0f1a',
            })
            .setOrigin(0.5)
            .setResolution(2);
          btn.on('pointerdown', () => btn.setAlpha(0.6));
          btn.on('pointerup', () => {
            btn.setAlpha(1);
            const res = claimSeasonMission(p.def.id);
            if (!res.ok) return;
            const sub =
              typeof res.grantedRna === 'number'
                ? `+${res.grantedRna} РНК`
                : typeof res.grantedBoosterDays === 'number'
                  ? `Бустер ×2 на ${res.grantedBoosterDays} дн.`
                  : 'Новый скин';
            showMetaToast(scene, p.def.title, sub, 'СЕЗОННАЯ МИССИЯ');
            // Принудительная перестройка: day не сменился, но claimed
            // изменился — без сброса таймер не перерисует доску.
            day = '';
            render();
          });
          this.root.add([btn, label]);
        } else if (p.complete) {
          // Выполнена, но paid-трек закрыт (без пропуска).
          text(rightX, y, 'ПРОПУСК', 10, VISUAL_TEXT.muted).setOrigin(1, 0);
        } else {
          text(rightX, y, fmtProgress(Math.min(p.progress, p.def.target), p.def.target), 11, VISUAL_TEXT.muted).setOrigin(1, 0);
        }
      });
    };
    render();
    this.timer = scene.time.addEvent({ delay: 1000, loop: true, callback: render });
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    PlatformBridge.setBackHandler(() => this.destroy());
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.timer?.remove(false);
    this.root.destroy();
    PlatformBridge.setBackHandler(null);
    this.dismissed();
  }
}
