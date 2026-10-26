import Phaser from 'phaser';
import { QuestRuntime } from '../quests/questRuntime';
import { nextUtcMidnightMs } from '../quests/questRotation';
import { SaveSystem } from '../systems/SaveSystem';
import { FONT, UI_FONT } from '../game/config';
import { META_COPY } from '../game/UiCopy';
import { fmtCountdown, fmtProgress } from '../game/UiFormat';
import { VISUAL, VISUAL_TEXT } from './visualTokens';
import { PlatformBridge } from '../platform';
import { createMetaDock, createModalFrame, MODAL, type MetaDockTarget } from './modal';

/**
 * Daily tasks board.
 *
 * Read-only mirror of the quest core: the board never grants anything and never
 * claims a reward. The countdown uses the rotation's own reset semantics — the
 * next UTC midnight — and the reset timing is not touched here.
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
    const render = () => {
      // UI only mirrors the product lifetime; it cannot emit gameplay or claim rewards.
      const snapshot = runtime.snapshot();
      const remaining = fmtCountdown(nextUtcMidnightMs(Date.now()) - Date.now());
      if (day === snapshot.dayKey && countdown === remaining) return;
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

      const completed = snapshot.progress.filter((p) => p.complete).length;
      text(
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
      const rowHeight = (h - (rowTop - top) - MODAL.dockHeight - 26) / Math.max(1, snapshot.progress.length);
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
