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
    id: 'rna-detected',
    atMs: 15_000,
    title: 'ЧУЖЕРОДНАЯ РНК ОБНАРУЖЕНА',
    subtitle: 'ИММУНИТЕТ НАЧИНАЕТ ПОИСК',
    color: COLORS.cyan,
  },
  {
    id: 'immune-response',
    atMs: 45_000,
    title: 'ИММУННЫЙ ОТВЕТ АКТИВИРОВАН',
    subtitle: 'АНТИТЕЛА МОБИЛИЗОВАНЫ',
    color: COLORS.orange,
  },
  {
    id: 't-cell-response',
    atMs: 90_000,
    title: 'T-КЛЕТКИ ПОДКЛЮЧЕНЫ',
    subtitle: 'ОХОТА НА ШТАММ УСКОРЯЕТСЯ',
    color: COLORS.purple,
  },
  {
    id: 'adaptive-immunity',
    atMs: 120_000,
    title: 'АДАПТИВНЫЙ ИММУНИТЕТ',
    subtitle: 'NK-КЛЕТКИ В ПОИСКЕ',
    color: COLORS.gold,
  },
  {
    id: 'systemic-response',
    atMs: 180_000,
    title: 'СИСТЕМНЫЙ ОТВЕТ',
    subtitle: 'КРОВОТОК НЕСТАБИЛЕН',
    color: COLORS.magenta,
  },
  {
    id: 'critical-immune-response',
    atMs: 240_000,
    title: 'КРИТИЧЕСКАЯ ИММУННАЯ РЕАКЦИЯ',
    subtitle: 'ДО IMMUNE PRIME — 01:00',
    color: COLORS.red,
  },
];

/**
 * Presentation-only immune escalation: reads run time and creates one-shot messages.
 * Enemy composition and boss timing stay owned by WaveDirector/config.
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
        fontSize: H < 620 ? '13px' : '15px',
        fontStyle: 'bold',
        color: '#e8f4ff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    const subtitle = this.scene.add
      .text(0, 10, def.subtitle, {
        fontFamily: FONT,
        fontSize: H < 620 ? '9px' : '10px',
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
