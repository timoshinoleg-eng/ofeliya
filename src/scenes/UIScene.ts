import Phaser from 'phaser';
import { getAchievementDef, type AchievementId } from '../game/AchievementSystem';
import {
  createChallengePayload,
  encodeChallengePayload,
  isChallengeBeaten,
  type ChallengePayloadV1,
} from '../game/Challenge';
import { COLORS, COMBO, FONT, JUICE, fmtTime } from '../game/config';
import { getEvolutionDef } from '../game/EvolutionSystem';
import { IDENTITY } from '../game/identity';
import { Joystick } from '../game/Joystick';
import {
  EVOLUTION_NAMES,
  UPGRADE_FAMILY_LABELS,
  UPGRADES,
  getUpgradeProgress,
  type EvolutionId,
  type UpgradeDef,
} from '../game/UpgradeSystem';
import { PlatformBridge } from '../platform';
import { Sfx } from '../systems/Sfx';
import type { GameScene } from './GameScene';

interface RunSnapshot {
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  xpNext: number;
  timeMs: number;
  kills: number;
  combo: number;
  bossHp: number;
  bossMax: number;
}

interface RunResult {
  win: boolean;
  timeMs: number;
  kills: number;
  hostCellsInfected: number;
  level: number;
  comboBest: number;
  stacks: Record<string, number>;
  evolutions: EvolutionId[];
  newAchievements: AchievementId[];
  records: { timeRecord: boolean; killsRecord: boolean; levelRecord: boolean };
}

const DEPTH = 50;

type TintableEmitter = Phaser.GameObjects.Particles.ParticleEmitter & {
  setParticleTint?: (color: number) => void;
};

export class UIScene extends Phaser.Scene {
  private gs: GameScene | null = null;

  private xpBack!: Phaser.GameObjects.Graphics;
  private xpFill!: Phaser.GameObjects.Graphics;
  private hpBack!: Phaser.GameObjects.Graphics;
  private hpFill!: Phaser.GameObjects.Graphics;
  private bossBack!: Phaser.GameObjects.Graphics;
  private bossFill!: Phaser.GameObjects.Graphics;
  private bossLabel!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private killsText!: Phaser.GameObjects.Text;
  private hpText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;
  private joystick!: Joystick;
  private hpWarn!: Phaser.GameObjects.Graphics;
  private fanfare!: Phaser.GameObjects.Particles.ParticleEmitter;
  private comboText!: Phaser.GameObjects.Text;
  private lastCombo = 0;

  private modal: Phaser.GameObjects.Container | null = null;
  private modalOpen = false;
  private overShown = false;
  private uiBlocked = false;

  constructor() {
    super('UI');
  }

  create(): void {
    this.gs = this.scene.get('Game') as GameScene;
    this.modalOpen = false;
    this.overShown = false;
    this.uiBlocked = false;
    this.modal = null;

    const W = this.scale.width;

    this.xpBack = this.add.graphics().setDepth(DEPTH);
    this.xpFill = this.add.graphics().setDepth(DEPTH + 1);
    this.hpBack = this.add.graphics().setDepth(DEPTH);
    this.hpFill = this.add.graphics().setDepth(DEPTH + 1);
    this.bossBack = this.add.graphics().setDepth(DEPTH);
    this.bossFill = this.add.graphics().setDepth(DEPTH + 1);

    const text = (
      x: number,
      y: number,
      s: string,
      size: number,
      color: string,
      ox = 0.5
    ): Phaser.GameObjects.Text =>
      this.add
        .text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color })
        .setOrigin(ox, 0)
        .setResolution(2)
        .setDepth(DEPTH + 1);

    this.timerText = text(W / 2, 28, '00:00', 24, '#e8f4ff');
    this.levelText = text(16, 30, 'МУТАЦИЯ 1', 13, '#ff78c8', 0);
    this.killsText = text(W - 16, 30, 'ИММУН. 0', 13, '#dff8ff', 1);
    this.hpText = text(W / 2, 58, '', 10, '#e8f4ff');
    this.bossLabel = text(W / 2, 72, IDENTITY.boss, 11, '#ff3860');
    this.muteText = this.add
      .text(W - 16, 54, '♪', { fontFamily: FONT, fontSize: '16px', color: Sfx.muted ? '#5a6480' : '#35e0ff' })
      .setOrigin(1, 0)
      .setResolution(2)
      .setDepth(DEPTH + 1)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        const muted = Sfx.toggle();
        this.muteText.setText('♪').setColor(muted ? '#5a6480' : '#35e0ff');
      });

    this.hpWarn = this.add.graphics().setDepth(DEPTH - 1);
    this.fanfare = this.add
      .particles(0, 0, 'spark', {
        speed: { min: 140, max: 330 },
        lifespan: { min: 320, max: 620 },
        scale: { start: 1, end: 0 },
        blendMode: 'ADD',
        tint: COLORS.cyan,
        emitting: false,
      })
      .setDepth(101);

    this.lastCombo = 0;
    this.comboText = this.add
      .text(16, 54, '', {
        fontFamily: FONT,
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffe066',
      })
      .setResolution(2)
      .setDepth(DEPTH + 1)
      .setVisible(false);

    this.joystick = new Joystick(this, () => this.uiBlocked);

    this.scale.on('resize', this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.layout, this);
    });
    this.layout();
  }

  update(): void {
    const run = this.registry.get('run') as RunSnapshot | undefined;
    const W = this.scale.width;
    const H = this.scale.height;
    if (run) {
      this.xpBack.clear();
      this.xpBack.fillStyle(0x1a2136, 0.9);
      this.xpBack.fillRoundedRect(12, 12, W - 24, 10, 5);
      this.xpFill.clear();
      const xf = Phaser.Math.Clamp(run.xp / run.xpNext, 0, 1);
      if (xf > 0) {
        this.xpFill.fillStyle(COLORS.magenta, 1);
        this.xpFill.fillRoundedRect(12, 12, Math.max((W - 24) * xf, 10), 10, 5);
      }

      this.timerText.setText(fmtTime(run.timeMs));
      this.levelText.setText(`МУТАЦИЯ ${run.level}`);
      this.killsText.setText(`ИММУН. ${run.kills}`);

      const showCombo = run.combo >= COMBO.showFrom;
      this.comboText.setVisible(showCombo);
      if (showCombo && run.combo !== this.lastCombo) {
        this.lastCombo = run.combo;
        this.comboText.setText(`×${run.combo}`);
        this.tweens.killTweensOf(this.comboText);
        this.comboText.setScale(1.4);
        this.tweens.add({ targets: this.comboText, scale: 1, duration: 200, ease: 'Quad.Out' });
      } else if (!showCombo) {
        this.lastCombo = 0;
      }

      const bw = 200;
      const bx = W / 2 - bw / 2;
      this.hpBack.clear();
      this.hpBack.fillStyle(0x1a2136, 0.9);
      this.hpBack.fillRoundedRect(bx, 54, bw, 12, 6);
      this.hpFill.clear();
      const hf = Phaser.Math.Clamp(run.hp / run.maxHp, 0, 1);
      if (hf > 0) {
        this.hpFill.fillStyle(hf > 0.35 ? COLORS.green : 0xff5a5a, 1);
        this.hpFill.fillRoundedRect(bx, 54, Math.max(bw * hf, 10), 12, 6);
      }
      this.hpText.setText(`${Math.ceil(Math.max(0, run.hp))} / ${run.maxHp}`);

      this.hpWarn.clear();
      if (run.hp > 0 && hf <= JUICE.lowHpFraction) {
        const a = 0.22 + 0.22 * Math.sin(this.time.now / 120);
        this.hpWarn.lineStyle(16, COLORS.red, a);
        this.hpWarn.strokeRect(8, 8, W - 16, H - 16);
      }

      const boss = run.bossMax > 0;
      this.bossBack.setVisible(boss);
      this.bossFill.setVisible(boss);
      this.bossLabel.setVisible(boss);
      if (boss) {
        this.bossBack.clear();
        this.bossBack.fillStyle(0x1a2136, 0.9);
        this.bossBack.fillRoundedRect(W / 2 - 140, 82, 280, 9, 4);
        this.bossFill.clear();
        this.bossFill.fillStyle(COLORS.red, 1);
        this.bossFill.fillRoundedRect(
          W / 2 - 140,
          82,
          Math.max(280 * Phaser.Math.Clamp(run.bossHp / run.bossMax, 0, 1), 8),
          9,
          4
        );
      }
    }

    if (this.gs && this.gs.awaitingChoice && !this.modalOpen && !this.overShown) {
      this.showLevelUp();
    }

    const res = this.registry.get('runResult') as RunResult | undefined | null;
    if (res && !this.overShown) {
      this.overShown = true;
      this.hideModal();
      this.showGameOver(res);
    }
  }

  private layout(): void {
    const W = this.scale.width;
    this.timerText.setX(W / 2);
    this.levelText.setX(16);
    this.killsText.setX(W - 16);
    this.hpText.setX(W / 2);
    this.bossLabel.setX(W / 2);
    this.muteText.setX(W - 16);
  }

  private showLevelUp(): void {
    const gs = this.gs;
    if (!gs) return;
    this.modalOpen = true;
    this.uiBlocked = true;
    this.scene.pause('Game');
    Sfx.play('levelup');
    PlatformBridge.notify('success');
    PlatformBridge.haptic('medium');

    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 620;
    const c = this.add.container(0, 0).setDepth(100);
    this.modal = c;

    const dim = this.add.rectangle(W / 2, H / 2, W, H, 0x09040a, 0.91).setInteractive();
    c.add(dim);

    const ring = this.add
      .circle(W / 2, H / 2, 20)
      .setStrokeStyle(3, COLORS.magenta, 0.92)
      .setDepth(101);
    this.tweens.add({
      targets: ring,
      scale: 7,
      alpha: 0,
      duration: 520,
      ease: 'Quad.Out',
      onComplete: () => ring.destroy(),
    });
    this.fanfare.emitParticleAt(W / 2, H / 2, 22);

    const titleY = compact ? H * 0.1 : H * 0.13;
    const titleT = this.add
      .text(W / 2, titleY, IDENTITY.levelUp, {
        fontFamily: FONT,
        fontSize: compact ? '23px' : '27px',
        fontStyle: 'bold',
        color: '#ff78c8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(255,79,181,0.72)', 16, true, true);
    c.add(titleT);
    titleT.setScale(0.7);
    this.tweens.add({ targets: titleT, scale: 1, duration: 260, ease: 'Back.Out' });
    c.add(
      this.add
        .text(W / 2, titleY + (compact ? 31 : 38), `стадия ${gs.runState.level} · выбери мутацию`, {
          fontFamily: FONT,
          fontSize: compact ? '12px' : '14px',
          color: '#aab4d4',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const cards = gs.pendingChoices;
    const cw = Math.min(W - 28, 360);
    const ch = compact ? 94 : 106;
    const gap = compact ? 8 : 10;
    const totalH = cards.length * ch + (cards.length - 1) * gap;
    const blockCenter = compact ? H * 0.56 : H * 0.55;
    let y = blockCenter - totalH / 2 + ch / 2;

    cards.forEach((def: UpgradeDef, cardIndex: number) => {
      const card = this.add.container(W / 2, y);
      const evolution = def.kind === 'evolution';
      const accent = evolution ? COLORS.gold : def.rarity === 'rare' ? COLORS.purple : COLORS.cyan;
      const progress = getUpgradeProgress(gs.runState, def);
      const bg = this.add
        .rectangle(0, 0, cw, ch, COLORS.panel, 0.985)
        .setStrokeStyle(evolution ? 3 : def.rarity === 'rare' ? 2.5 : 2, accent, evolution ? 1 : 0.85);
      card.add(bg);

      if (evolution) {
        card.add(
          this.add
            .rectangle(0, 0, cw - 6, ch - 6, COLORS.gold, 0.035)
            .setStrokeStyle(1, COLORS.gold, 0.28)
        );
      }

      const iconKey = evolution && def.evolutionId ? `mutation-${def.evolutionId}` : `up-${def.id}`;
      const hasIcon = this.textures.exists(iconKey);
      if (hasIcon) {
        card.add(
          this.add
            .image(-cw / 2 + 38, -2, iconKey)
            .setScale(compact ? 0.82 : 0.9)
            .setTint(evolution ? COLORS.gold : def.rarity === 'rare' ? 0xe9dcff : 0xffffff)
        );
      }

      const tx = -cw / 2 + (hasIcon ? 68 : 16);
      const right = cw / 2 - 12;
      const family = evolution
        ? 'КРИТИЧЕСКАЯ МУТАЦИЯ'
        : `${UPGRADE_FAMILY_LABELS[def.family]} · ${def.rarity === 'rare' ? 'РЕДКИЙ' : 'СТАНДАРТ'}`;
      card.add(
        this.add
          .text(tx, -ch / 2 + 8, family, {
            fontFamily: FONT,
            fontSize: compact ? '9px' : '10px',
            fontStyle: 'bold',
            color: evolution ? '#ffe066' : def.rarity === 'rare' ? '#cbb6ff' : '#73eaff',
          })
          .setResolution(2)
      );

      card.add(
        this.add
          .text(tx, -ch / 2 + (compact ? 22 : 24), def.shortName, {
            fontFamily: FONT,
            fontSize: evolution ? (compact ? '16px' : '18px') : compact ? '14px' : '15px',
            fontStyle: 'bold',
            color: evolution ? '#ffe066' : '#e8f4ff',
          })
          .setResolution(2)
      );

      card.add(
        this.add
          .text(tx, -ch / 2 + (compact ? 43 : 47), def.name, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: evolution ? '#fff1ac' : def.rarity === 'rare' ? '#cbb6ff' : '#73eaff',
            wordWrap: { width: Math.max(100, right - tx) },
          })
          .setResolution(2)
      );

      if (!compact && !evolution) {
        card.add(
          this.add
            .text(tx, -ch / 2 + 64, def.desc, {
              fontFamily: FONT,
              fontSize: '10px',
              color: '#8f9ab7',
              wordWrap: { width: Math.max(100, right - tx - 4) },
            })
            .setResolution(2)
        );
      }

      if (!evolution && def.evolutionHint) {
        card.add(
          this.add
            .text(right, -ch / 2 + 9, `→ ${EVOLUTION_NAMES[def.evolutionHint]}`, {
              fontFamily: FONT,
              fontSize: compact ? '9px' : '10px',
              fontStyle: 'bold',
              color: '#ffe066',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      }

      if (def.showProgress !== false && def.max <= 8) {
        const pg = this.add.graphics();
        const barX = tx;
        const barY = ch / 2 - 13;
        const available = Math.min(118, Math.max(72, right - tx - 64));
        const segGap = 3;
        const segW = (available - segGap * (def.max - 1)) / def.max;
        for (let i = 0; i < def.max; i++) {
          const x = barX + i * (segW + segGap);
          const completed = i < progress.current;
          const next = i === progress.current;
          pg.fillStyle(accent, completed ? 0.95 : next ? 0.42 : 0.1);
          pg.fillRoundedRect(x, barY, segW, 5, 2);
        }
        card.add(pg);
        card.add(
          this.add
            .text(right, barY - 5, `${progress.current} → ${progress.next} / ${progress.max}`, {
              fontFamily: FONT,
              fontSize: '9px',
              color: '#7f8aa7',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      } else {
        card.add(
          this.add
            .text(right, ch / 2 - 19, evolution ? 'ЗАКРЕПИТЬ МУТАЦИЮ' : 'РАЗОВАЯ АДАПТАЦИЯ', {
              fontFamily: FONT,
              fontSize: '9px',
              fontStyle: evolution ? 'bold' : 'normal',
              color: evolution ? '#ffe066' : '#7dff6e',
            })
            .setOrigin(1, 0)
            .setResolution(2)
        );
      }

      bg.setInteractive({ useHandCursor: true }).on('pointerup', () => {
        Sfx.play('click');
        const more = gs.chooseUpgrade(def.id);
        const evolutionId = gs.consumeEvolutionCeremony();
        if (evolutionId) {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.showEvolutionCeremony(evolutionId, more);
        } else if (more) {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.modalOpen = false;
          this.showLevelUp();
        } else {
          this.hideModal();
          this.scene.resume('Game');
        }
      });
      bg.on('pointerover', () => bg.setFillStyle(evolution ? 0x332d18 : COLORS.panelHover, 1));
      bg.on('pointerout', () => bg.setFillStyle(COLORS.panel, 0.985));

      c.add(card);
      card.setScale(0.94).setAlpha(0);
      this.tweens.add({
        targets: card,
        scale: 1,
        alpha: 1,
        duration: 170,
        delay: cardIndex * 35,
        ease: 'Back.Out',
      });

      y += ch + gap;
    });
  }

  private showEvolutionCeremony(id: EvolutionId, moreChoices: boolean): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const def = getEvolutionDef(id);
    this.modalOpen = true;
    this.uiBlocked = true;

    const c = this.add.container(0, 0).setDepth(106);
    this.modal = c;
    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x03040a, 0.9).setInteractive());

    const outer = this.add
      .circle(W / 2, H * 0.43, 58)
      .setStrokeStyle(3, COLORS.gold, 0.9)
      .setBlendMode(Phaser.BlendModes.ADD);
    const inner = this.add
      .circle(W / 2, H * 0.43, 30)
      .setStrokeStyle(2, COLORS.white, 0.7)
      .setBlendMode(Phaser.BlendModes.ADD);
    const emblem = this.add
      .image(W / 2, H * 0.43, `mutation-${id}`)
      .setScale(1.18)
      .setAlpha(0.96)
      .setBlendMode(Phaser.BlendModes.ADD);
    c.add([outer, inner, emblem]);
    this.tweens.add({ targets: outer, scale: 1.75, alpha: 0.08, duration: 760, ease: 'Quad.Out' });
    this.tweens.add({ targets: inner, scale: 0.55, alpha: 1, duration: 300, yoyo: true, ease: 'Sine.InOut' });
    emblem.setScale(0.62);
    this.tweens.add({ targets: emblem, scale: 1.18, duration: 420, ease: 'Back.Out' });

    (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.gold);
    this.fanfare.emitParticleAt(W / 2, H * 0.43, 38);

    c.add(
      this.add
        .text(W / 2, H * 0.21, 'КРИТИЧЕСКАЯ МУТАЦИЯ', {
          fontFamily: FONT,
          fontSize: '18px',
          fontStyle: 'bold',
          color: '#fff1ac',
          letterSpacing: 2,
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const name = this.add
      .text(W / 2, H * 0.31, def.name, {
        fontFamily: FONT,
        fontSize: H < 620 ? '30px' : '38px',
        fontStyle: 'bold',
        color: '#ffe066',
        align: 'center',
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setShadow(0, 0, 'rgba(255,224,102,0.85)', 20, true, true);
    c.add(name);
    name.setScale(0.6);
    this.tweens.add({ targets: name, scale: 1, duration: 380, ease: 'Back.Out' });

    c.add(
      this.add
        .text(W / 2, H * 0.61, def.effect, {
          fontFamily: FONT,
          fontSize: '13px',
          color: '#e8f4ff',
          align: 'center',
          wordWrap: { width: Math.min(W - 48, 360) },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );
    c.add(
      this.add
        .text(W / 2, H * 0.69, 'ШТАММ ИЗМЕНИЛСЯ', {
          fontFamily: FONT,
          fontSize: '12px',
          fontStyle: 'bold',
          color: '#ffe066',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    Sfx.play('levelup');
    this.time.delayedCall(130, () => Sfx.play(id === 'singularity' ? 'nova' : 'elite'));
    PlatformBridge.haptic('heavy');

    this.time.delayedCall(1050, () => {
      this.tweens.add({
        targets: c,
        alpha: 0,
        duration: 240,
        onComplete: () => {
          c.destroy();
          if (this.modal === c) this.modal = null;
          this.modalOpen = false;
          this.uiBlocked = false;
          (this.fanfare as TintableEmitter).setParticleTint?.(COLORS.cyan);
          if (moreChoices) this.showLevelUp();
          else this.scene.resume('Game');
        },
      });
    });
  }

  private hideModal(): void {
    this.modal?.destroy();
    this.modal = null;
    this.modalOpen = false;
    this.uiBlocked = false;
  }

  private showGameOver(res: RunResult): void {
    this.uiBlocked = true;
    const W = this.scale.width;
    const H = this.scale.height;
    const compact = H < 650;
    const c = this.add.container(0, 0).setDepth(110);

    c.add(this.add.rectangle(W / 2, H / 2, W, H, 0x05070f, 0.84).setInteractive());

    const titleY = compact ? H * 0.1 : H * 0.13;
    c.add(
      this.add
        .text(W / 2, titleY, res.win ? 'ИММУНИТЕТ ПОДАВЛЕН' : 'ШТАММ УНИЧТОЖЕН', {
          fontFamily: FONT,
          fontSize: res.win ? (compact ? '22px' : '27px') : compact ? '27px' : '32px',
          fontStyle: 'bold',
          color: res.win ? '#ffe066' : '#ff3860',
          align: 'center',
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setShadow(0, 0, res.win ? 'rgba(255,224,102,0.7)' : 'rgba(255,56,96,0.7)', 16, true, true)
    );

    c.add(
      this.add
        .text(W / 2, titleY + (compact ? 42 : 54), fmtTime(res.timeMs), {
          fontFamily: FONT,
          fontSize: compact ? '38px' : '46px',
          fontStyle: 'bold',
          color: '#e8f4ff',
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const statY = titleY + (compact ? 79 : 100);
    c.add(
      this.add
        .text(
          W / 2,
          statY,
          `${IDENTITY.kills}: ${res.kills}   ·   Клеток: ${res.hostCellsInfected}   ·   Мутация: ${res.level}   ·   ×${res.comboBest}`,
          {
            fontFamily: FONT,
            fontSize: compact ? '11px' : '13px',
            color: '#aab4d4',
          }
        )
        .setOrigin(0.5)
        .setResolution(2)
    );

    let detailY = statY + 27;
    const evoText = res.evolutions.length > 0
      ? res.evolutions.map((id) => EVOLUTION_NAMES[id]).join(' · ')
      : 'нет';
    c.add(
      this.add
        .text(W / 2, detailY, `КРИТ. МУТАЦИИ: ${evoText}`, {
          fontFamily: FONT,
          fontSize: compact ? '10px' : '11px',
          fontStyle: 'bold',
          color: res.evolutions.length > 0 ? '#ffe066' : '#5a6480',
          align: 'center',
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    detailY += compact ? 25 : 29;
    const build = this.buildSummary(res.stacks);
    c.add(
      this.add
        .text(W / 2, detailY, `ШТАММ: ${build || 'базовый штамм'}`, {
          fontFamily: FONT,
          fontSize: compact ? '9px' : '10px',
          color: '#8f9ab7',
          align: 'center',
          wordWrap: { width: W - 42 },
        })
        .setOrigin(0.5)
        .setResolution(2)
    );

    const rec: string[] = [];
    if (res.records.timeRecord && res.timeMs > 0) rec.push(res.win ? 'победа' : 'выживание');
    if (res.records.killsRecord) rec.push('иммунитет');
    if (res.records.levelRecord) rec.push('мутация');
    if (rec.length > 0) {
      detailY += compact ? 24 : 28;
      c.add(
        this.add
          .text(W / 2, detailY, `НОВЫЕ ЗАПИСИ: ${rec.join(' · ')}`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: '#73eaff',
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    if (res.newAchievements.length > 0) {
      detailY += compact ? 24 : 29;
      const labels = res.newAchievements.slice(0, 2).map((id) => getAchievementDef(id).name);
      const extra = res.newAchievements.length > 2 ? ` +${res.newAchievements.length - 2}` : '';
      c.add(
        this.add
          .text(W / 2, detailY, `НОВОЕ ДОСТИЖЕНИЕ: ${labels.join(' · ')}${extra}`, {
            fontFamily: FONT,
            fontSize: compact ? '9px' : '10px',
            fontStyle: 'bold',
            color: '#ffe066',
            align: 'center',
            wordWrap: { width: W - 42 },
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const challengeTarget = this.registry.get('challengeTarget') as ChallengePayloadV1 | null | undefined;
    if (challengeTarget) {
      detailY += compact ? 24 : 29;
      const beaten = isChallengeBeaten(challengeTarget, res);
      const target =
        challengeTarget.objective === 'clear'
          ? `быстрее ${fmtTime(challengeTarget.timeMs)}`
          : `дольше ${fmtTime(challengeTarget.timeMs)}`;
      c.add(
        this.add
          .text(W / 2, detailY, `ВЫЗОВ ${beaten ? 'ПРЕВЗОЙДЁН' : 'НЕ ПРЕВЗОЙДЁН'} · цель ${target}`, {
            fontFamily: FONT,
            fontSize: compact ? '10px' : '11px',
            fontStyle: 'bold',
            color: beaten ? '#7fffa1' : '#ff9b66',
            align: 'center',
            wordWrap: { width: W - 42 },
          })
          .setOrigin(0.5)
          .setResolution(2)
      );
    }

    const gs = this.gs;
    const gap = compact ? 50 : 56;
    const desiredY = Math.max(H * (compact ? 0.66 : 0.68), detailY + (compact ? 54 : 62));
    const maxFirstY = H - 24 - gap * 2;
    let y = Math.min(desiredY, maxFirstY);
    this.button(c, 'ЕЩЁ ОДИН ЦИКЛ', W / 2, y, true, () => {
      this.scene.stop();
      if (gs) {
        gs.scene.resume();
        gs.scene.restart();
      }
    });
    y += gap;
    this.button(c, 'БРОСИТЬ ВЫЗОВ', W / 2, y, false, () => {
      const mins = fmtTime(res.timeMs);
      const evoShare = res.evolutions.length > 0 ? ` Критические мутации: ${res.evolutions.map((id) => EVOLUTION_NAMES[id]).join(', ')}.` : '';
      const shareText = res.win
        ? `OFELIYA / STRAIN-0 подавила иммунитет за ${mins}. Иммунных клеток: ${res.kills}, заражено клеток: ${res.hostCellsInfected}.${evoShare} Сможешь быстрее?`
        : `Мой STRAIN-0 выжил ${mins}. Иммунных клеток: ${res.kills}, заражено клеток: ${res.hostCellsInfected}.${evoShare} Сможешь дольше?`;
      const payload = encodeChallengePayload(createChallengePayload(res));
      const link = payload ? PlatformBridge.buildStartLink(payload) : null;
      void PlatformBridge.shareResult(shareText, link ?? undefined).then((ok) => {
        if (!ok) {
          this.toast(c, 'Нативный шаринг недоступен в этом клиенте');
        } else if (!link && PlatformBridge.kind === 'max') {
          this.toast(c, 'Ссылка вызова не настроена');
        }
      });
    });
    y += gap;
    this.button(c, 'В МЕНЮ', W / 2, y, false, () => {
      this.scene.stop();
      if (gs) {
        gs.scene.stop();
        gs.scene.start('Menu');
      }
    });
  }

  private buildSummary(stacks: Record<string, number>): string {
    const labels: Record<string, string> = {
      dmg: 'ШИПЫ',
      rate: 'РЕПЛИКАЦИЯ',
      multi: 'КОПИИ',
      pierce: 'ПРОНИКН.',
      speed: 'ПОДВИЖН.',
      hp: 'КАПСИД',
      magnet: 'АФФИНИТЕТ',
      orbit: 'СПУТНИКИ',
      nova: 'ЛИЗИС',
      regen: 'РЕКОМБ.',
    };
    return Object.entries(stacks)
      .filter(([id, n]) => n > 0 && UPGRADES.some((u) => u.id === id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => `${labels[id] ?? id.toUpperCase()} ${n}`)
      .join(' · ');
  }

  private button(
    c: Phaser.GameObjects.Container,
    label: string,
    x: number,
    y: number,
    primary: boolean,
    cb: () => void
  ): void {
    const w = 230;
    const h = 46;
    const bg = this.add
      .rectangle(x, y, w, h, primary ? COLORS.magenta : COLORS.panel, primary ? 0.18 : 0.95)
      .setStrokeStyle(2, primary ? COLORS.magenta : COLORS.stroke, 1);
    const t = this.add
      .text(x, y, label, {
        fontFamily: FONT,
        fontSize: '16px',
        fontStyle: 'bold',
        color: primary ? '#ff78c8' : '#fff4ec',
      })
      .setOrigin(0.5)
      .setResolution(2);
    bg.setInteractive({ useHandCursor: true }).on('pointerup', () => cb());
    bg.on('pointerover', () => bg.setFillStyle(COLORS.panelHover, 1));
    bg.on('pointerout', () =>
      bg.setFillStyle(primary ? COLORS.magenta : COLORS.panel, primary ? 0.18 : 0.95)
    );
    c.add([bg, t]);
  }

  private toast(c: Phaser.GameObjects.Container, msg: string): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const t = this.add
      .text(W / 2, H * 0.9, msg, {
        fontFamily: FONT,
        fontSize: '13px',
        color: '#aab4d4',
        backgroundColor: '#141a2e',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setAlpha(0);
    c.add(t);
    this.tweens.add({
      targets: t,
      alpha: 1,
      duration: 150,
      yoyo: true,
      hold: 1200,
      onComplete: () => t.destroy(),
    });
  }
}
