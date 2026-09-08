import Phaser from 'phaser';
import { COLORS } from './config';

/**
 * Strain Zero art foundation. The textures are generated once and then reused by pools/scenes.
 * The goal is silhouette/readability first: premium microscopic-biopunk direction without
 * adding network art dependencies or per-frame procedural drawing cost.
 */
export function ensureStrainZeroTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('virus-player')) return;

  const g = scene.add.graphics();

  // OFELIYA / STRAIN-0 — enveloped virion with visible protein spikes and RNA core.
  g.fillStyle(0x2b0a2a, 1);
  g.fillCircle(22, 22, 14);
  g.lineStyle(2.4, COLORS.magenta, 0.95);
  g.strokeCircle(22, 22, 14);
  g.lineStyle(1.2, 0xff9fda, 0.5);
  g.strokeCircle(22, 22, 10);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x0 = 22 + Math.cos(a) * 14;
    const y0 = 22 + Math.sin(a) * 14;
    const x1 = 22 + Math.cos(a) * 19;
    const y1 = 22 + Math.sin(a) * 19;
    g.lineStyle(2, i % 3 === 0 ? COLORS.green : COLORS.magenta, 0.9);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.strokePath();
    g.fillStyle(i % 3 === 0 ? COLORS.green : 0xff78c8, 0.95);
    g.fillCircle(x1, y1, 2.1);
  }
  // RNA coil.
  g.lineStyle(2, COLORS.green, 0.9);
  g.beginPath();
  g.moveTo(14, 22);
  g.lineTo(18, 17);
  g.lineTo(22, 26);
  g.lineTo(26, 18);
  g.lineTo(30, 23);
  g.strokePath();
  g.fillStyle(COLORS.white, 0.75);
  g.fillCircle(22, 22, 2.2);
  g.generateTexture('virus-player', 44, 44);
  g.clear();

  // Viral projectile: protein/RNA packet.
  g.fillStyle(0x42103f, 1);
  g.fillRoundedRect(1, 2, 13, 6, 3);
  g.lineStyle(1.5, COLORS.magenta, 1);
  g.strokeRoundedRect(1, 2, 13, 6, 3);
  g.fillStyle(COLORS.green, 0.9);
  g.fillCircle(10.5, 5, 1.5);
  g.generateTexture('viral-particle', 16, 10);
  g.clear();

  // Antibody — unmistakable Y silhouette.
  g.lineStyle(4, 0xe8faff, 0.95);
  g.beginPath();
  g.moveTo(13, 23);
  g.lineTo(13, 13);
  g.lineTo(6, 5);
  g.moveTo(13, 13);
  g.lineTo(20, 5);
  g.strokePath();
  g.lineStyle(1.5, COLORS.cyan, 0.85);
  g.beginPath();
  g.moveTo(13, 23);
  g.lineTo(13, 13);
  g.lineTo(6, 5);
  g.moveTo(13, 13);
  g.lineTo(20, 5);
  g.strokePath();
  g.fillStyle(COLORS.white, 0.95);
  g.fillCircle(6, 5, 2.5);
  g.fillCircle(20, 5, 2.5);
  g.generateTexture('immune-antibody', 26, 26);
  g.clear();

  // T-killer — compact immune cell with dense nucleus and directional receptors.
  g.fillStyle(0xdff8ff, 0.94);
  g.fillCircle(15, 15, 13);
  g.lineStyle(2, COLORS.cyan, 0.9);
  g.strokeCircle(15, 15, 12);
  g.fillStyle(0x47627d, 0.9);
  g.fillCircle(12.5, 15.5, 7);
  g.fillStyle(0x8ed8ef, 0.8);
  g.fillCircle(19.5, 10, 3);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.fillStyle(COLORS.white, 0.95);
    g.fillCircle(15 + Math.cos(a) * 13, 15 + Math.sin(a) * 13, 1.8);
  }
  g.generateTexture('immune-tcell', 30, 30);
  g.clear();

  // Macrophage — large asymmetric blob, readable as engulfing mass.
  const macrophage = [
    { x: 5, y: 13 },
    { x: 10, y: 5 },
    { x: 20, y: 3 },
    { x: 31, y: 7 },
    { x: 38, y: 15 },
    { x: 36, y: 27 },
    { x: 29, y: 37 },
    { x: 17, y: 39 },
    { x: 7, y: 33 },
    { x: 3, y: 23 },
  ];
  g.fillStyle(0xfff0d0, 0.94);
  g.fillPoints(macrophage, true);
  g.lineStyle(2.2, 0xffc979, 0.95);
  g.strokePoints(macrophage, true);
  g.fillStyle(0x7d4667, 0.82);
  g.fillEllipse(20, 21, 17, 12);
  g.fillStyle(0xffffff, 0.5);
  g.fillCircle(11, 15, 3);
  g.fillCircle(29, 29, 2.5);
  g.generateTexture('immune-macrophage', 42, 42);
  g.clear();

  // IMMUNE PRIME — multi-lobed final response, larger but still clean at phone size.
  g.fillStyle(0xf6fbff, 0.96);
  g.fillCircle(36, 36, 32);
  g.lineStyle(3, COLORS.cyan, 0.95);
  g.strokeCircle(36, 36, 31);
  g.fillStyle(0x38506d, 0.92);
  g.fillCircle(29, 33, 12);
  g.fillCircle(43, 29, 11);
  g.fillCircle(40, 45, 12);
  g.lineStyle(1.5, 0xffffff, 0.55);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = 36 + Math.cos(a) * 31;
    const y = 36 + Math.sin(a) * 31;
    g.beginPath();
    g.moveTo(36 + Math.cos(a) * 25, 36 + Math.sin(a) * 25);
    g.lineTo(x, y);
    g.strokePath();
    g.fillStyle(COLORS.white, 0.9);
    g.fillCircle(x, y, 2.3);
  }
  g.generateTexture('immune-prime', 72, 72);
  g.clear();

  // RNA collectible — double-strand-ish zigzag, green by design to separate it from immune whites.
  g.lineStyle(2.2, COLORS.green, 1);
  g.beginPath();
  g.moveTo(3, 2);
  g.lineTo(11, 6);
  g.lineTo(3, 10);
  g.lineTo(11, 14);
  g.lineTo(3, 18);
  g.strokePath();
  g.lineStyle(1.2, COLORS.white, 0.75);
  g.beginPath();
  g.moveTo(11, 2);
  g.lineTo(3, 6);
  g.lineTo(11, 10);
  g.lineTo(3, 14);
  g.lineTo(11, 18);
  g.strokePath();
  g.generateTexture('rna-fragment', 14, 20);
  g.clear();

  // Erythrocyte — ambient only, never a hostile target.
  g.fillStyle(0xb92c42, 0.92);
  g.fillEllipse(32, 22, 60, 38);
  g.lineStyle(2, 0xff6273, 0.48);
  g.strokeEllipse(32, 22, 58, 36);
  g.fillStyle(0x6d1729, 0.8);
  g.fillEllipse(32, 22, 28, 14);
  g.lineStyle(1, 0xff8792, 0.22);
  g.strokeEllipse(32, 22, 35, 19);
  g.generateTexture('erythrocyte', 64, 44);
  g.clear();

  // Large host-cell silhouette used for atmosphere now and infection gameplay later.
  g.fillStyle(0x6d2749, 0.38);
  g.fillCircle(48, 48, 43);
  g.lineStyle(2, 0xd25d86, 0.48);
  g.strokeCircle(48, 48, 41);
  g.fillStyle(0x2f1830, 0.7);
  g.fillEllipse(49, 50, 36, 29);
  g.lineStyle(1.2, 0xff93b5, 0.25);
  g.strokeEllipse(49, 50, 38, 31);
  g.generateTexture('host-cell-shadow', 96, 96);
  g.clear();

  g.destroy();

  const plasma = scene.textures.createCanvas('blood-plasma', 256, 256);
  if (plasma) {
    const ctx = plasma.getContext();
    const bg = ctx.createRadialGradient(128, 128, 20, 128, 128, 190);
    bg.addColorStop(0, '#2a0d18');
    bg.addColorStop(0.52, '#1b0811');
    bg.addColorStop(1, '#10050a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);

    // Soft vessel/membrane traces. Baked once, nearly free at runtime.
    for (let i = 0; i < 24; i++) {
      const x = (i * 83 + 17) % 256;
      const y = (i * 47 + 29) % 256;
      const r = 8 + ((i * 13) % 24);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,92,119,0.065)' : 'rgba(185,44,66,0.045)';
      ctx.lineWidth = 1 + (i % 2);
      ctx.stroke();
    }

    const glow = ctx.createLinearGradient(0, 0, 256, 256);
    glow.addColorStop(0, 'rgba(255,85,119,0.035)');
    glow.addColorStop(0.5, 'rgba(0,0,0,0)');
    glow.addColorStop(1, 'rgba(139,28,65,0.06)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 256, 256);
    plasma.refresh();
  }
}
