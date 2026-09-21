import Phaser from 'phaser';
import { FONT } from './config';
import type { StageMilestoneDefinition } from './StageDefinitions';

/**
 * Stage milestone presentation. StageDirector is the sole timeline authority.
 *
 * Audio ownership note: this class used to drive `Sfx.setRunIntensity` from stage elapsed time.
 * The bio pulse is now owned by `AdaptiveAudioDirector` and driven by real danger, so milestones
 * stay purely visual and there is exactly one owner of that audio voice.
 */
export class RunMilestones {
  private readonly scene: Phaser.Scene;
  private readonly active = new Set<Phaser.GameObjects.GameObject>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  show(def: StageMilestoneDefinition): void {
    const width = this.scene.scale.width;
    const height = this.scene.scale.height;
    const y = Math.max(118, height * 0.2);

    const pulse = this.scene.add
      .rectangle(0, 0, width, height, def.color, 0.055)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(29)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.active.add(pulse);
    this.scene.tweens.add({
      targets: pulse,
      alpha: 0,
      duration: 520,
      ease: 'Quad.Out',
      onComplete: () => {
        this.active.delete(pulse);
        pulse.destroy();
      },
    });

    const container = this.scene.add
      .container(width / 2, y)
      .setScrollFactor(0)
      .setDepth(42)
      .setAlpha(0);
    this.active.add(container);
    const panelWidth = Math.min(width - 32, 360);
    const panel = this.scene.add
      .rectangle(0, 0, panelWidth, 66, 0x070a14, 0.84)
      .setStrokeStyle(1.5, def.color, 0.72);
    const topLine = this.scene.add.rectangle(0, -31, panelWidth * 0.72, 2, def.color, 0.9);
    const title = this.scene.add
      .text(0, -17, def.title, {
        fontFamily: FONT,
        fontSize: height < 620 ? '13px' : '15px',
        fontStyle: 'bold',
        color: '#e8f4ff',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    const subtitle = this.scene.add
      .text(0, 10, def.subtitle, {
        fontFamily: FONT,
        fontSize: height < 620 ? '9px' : '10px',
        fontStyle: 'bold',
        color: `#${def.color.toString(16).padStart(6, '0')}`,
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2);
    container.add([panel, topLine, title, subtitle]);

    this.scene.tweens.add({
      targets: container,
      alpha: 1,
      y: y + 8,
      duration: 180,
      ease: 'Quad.Out',
      yoyo: true,
      hold: 820,
      onComplete: () => {
        this.active.delete(container);
        container.destroy();
      },
    });
  }

  reset(): void {
    for (const object of this.active) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.active.clear();
  }
}
