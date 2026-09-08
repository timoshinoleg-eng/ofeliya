import Phaser from 'phaser';
import { COLORS, FONT } from './config';

export interface RunMilestoneDef {
  id: string;
  atMs: number;
  title: string;
  subtitle: string;
  color: number;
}

export const RUN_MILESTONES: RunMilestoneDef[] = [
  {
    id: 'runner-signal',
    atMs: 45_000,
    title: 'НОВЫЙ СИГНАЛ',
    subtitle: 'ИМПУЛЬС ОБНАРУЖЕН',
    color: COLORS.orange,
  },
  {
    id: 'brute-signal',
    atMs: 90_000,
    title: 'СТРУКТУРА ПОВРЕЖДЕНА',
    subtitle: 'РАЗРЫВ ОБНАРУЖЕН',
    color: COLORS.purple,
  },
  {
    id: 'first-anomaly',
    atMs: 120_000,
    title: 'АНОМАЛИЯ',
    subtitle: 'СТАБИЛЬНОСТЬ СНИЖЕНА',
    color: COLORS.gold,
  },
  {
    id: 'overload',
    atMs: 180_000,
    title: 'СИСТЕМА ПЕРЕГРУЖЕНА',
    subtitle: 'ПЛОТНОСТЬ УГРОЗ РАСТЁТ',
    color: COLORS.magenta,
  },
  {
    id: 'critical',
    atMs: 240_000,
    title: 'КРИТИЧЕСКИЙ УРОВЕНЬ',
    subtitle: 'ДО СТАБИЛИЗАЦИИ ЯДРА — 01:00',
    color: COLORS.red,
  },
];

/**
 * Только presentation: читает время забега и создаёт одноразовые сообщения.
 * Не пишет в WaveDirector/config и не влияет на сложность или управление.
 */
export class RunMilestones {
  private readonly scene: Phaser.Scene;
  private nextIndex = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(runTimeMs: number): void {
    while (
      this.nextIndex < RUN_MILESTONES.length &&
      runTimeMs >= RUN_MILESTONES[this.nextIndex].atMs
    ) {
      this.show(RUN_MILESTONES[this.nextIndex]);
      this.nextIndex += 1;
    }
  }

  private show(def: RunMilestoneDef): void {
    const W = this.scene.scale.width;
    const H = this.scene.scale.height;
    const y = Math.max(118, H * 0.2);

    const pulse = this.scene.add
      .rectangle(0, 0, W, H, def.color, 0.055)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(29)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: pulse,
      alpha: 0,
      duration: 520,
      ease: 'Quad.Out',
      onComplete: () => pulse.destroy(),
    });

    const c = this.scene.add.container(W / 2, y).setScrollFactor(0).setDepth(42).setAlpha(0);
    const panelW = Math.min(W - 32, 360);
    const panel = this.scene.add
      .rectangle(0, 0, panelW, 66, 0x070a14, 0.84)
      .setStrokeStyle(1.5, def.color, 0.72);
    const topLine = this.scene.add.rectangle(0, -31, panelW * 0.72, 2, def.color, 0.9);
    const title = this.scene.add
      .text(0, -17, def.title, {
        fontFamily: FONT,
        fontSize: H < 620 ? '15px' : '17px',
        fontStyle: 'bold',
        color: '#e8f4ff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    const subtitle = this.scene.add
      .text(0, 10, def.subtitle, {
        fontFamily: FONT,
        fontSize: H < 620 ? '10px' : '11px',
        fontStyle: 'bold',
        color: `#${def.color.toString(16).padStart(6, '0')}`,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    c.add([panel, topLine, title, subtitle]);

    this.scene.tweens.add({
      targets: c,
      alpha: 1,
      y: y + 8,
      duration: 180,
      ease: 'Quad.Out',
      yoyo: true,
      hold: 820,
      onComplete: () => c.destroy(),
    });
  }
}
