import Phaser from 'phaser';
import { COLORS } from '../game/config';

/** Генерирует все текстуры кодом — ассеты не нужны, лицензионных рисков нет. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.makeTextures();
    document.getElementById('splash')?.remove();
    this.scene.start('Menu');
  }

  private makeTextures(): void {
    const g = this.add.graphics();

    // игрок — тёмный круг с неоновой обводкой и белым ядром
    g.fillStyle(0x0d1b2a, 1);
    g.fillCircle(14, 14, 13);
    g.lineStyle(2.5, COLORS.cyan, 1);
    g.strokeCircle(14, 14, 12);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(14, 14, 5);
    g.generateTexture('player', 28, 28);
    g.clear();

    // маркер цели (треугольник вправо)
    g.fillStyle(COLORS.cyan, 0.9);
    g.fillTriangle(16, 8, 0, 0, 0, 16);
    g.generateTexture('marker', 16, 16);
    g.clear();

    // пуля — капсула вправо
    g.fillStyle(COLORS.white, 1);
    g.fillRoundedRect(0, 0, 14, 6, 3);
    g.fillStyle(COLORS.cyan, 1);
    g.fillRoundedRect(3, 1.5, 8, 3, 1.5);
    g.generateTexture('bullet', 14, 6);
    g.clear();

    // роевик — круг
    g.fillStyle(0x3a1030, 1);
    g.fillCircle(12, 12, 11);
    g.lineStyle(2, COLORS.magenta, 1);
    g.strokeCircle(12, 12, 10);
    g.fillStyle(COLORS.magenta, 1);
    g.fillCircle(12, 12, 4);
    g.generateTexture('enemy-swarm', 24, 24);
    g.clear();

    // бегун — треугольник вправо
    g.fillStyle(0x3a2410, 1);
    g.fillTriangle(24, 12, 2, 2, 2, 22);
    g.lineStyle(2, COLORS.orange, 1);
    g.strokeTriangle(24, 12, 2, 2, 2, 22);
    g.generateTexture('enemy-runner', 24, 24);
    g.clear();

    // громила — квадрат
    g.fillStyle(0x2a1245, 1);
    g.fillRoundedRect(1, 1, 28, 28, 6);
    g.lineStyle(2, COLORS.purple, 1);
    g.strokeRoundedRect(2, 2, 26, 26, 6);
    g.fillStyle(COLORS.purple, 0.9);
    g.fillRect(10, 10, 10, 10);
    g.generateTexture('enemy-brute', 30, 30);
    g.clear();

    // босс
    g.fillStyle(0x3a0d18, 1);
    g.fillCircle(28, 28, 27);
    g.lineStyle(3, COLORS.red, 1);
    g.strokeCircle(28, 28, 25);
    g.lineStyle(2, COLORS.red, 0.6);
    g.strokeCircle(28, 28, 18);
    g.fillStyle(COLORS.red, 1);
    g.fillCircle(28, 28, 8);
    g.generateTexture('boss', 56, 56);
    g.clear();

    // кристалл опыта — ромб
    g.fillStyle(COLORS.green, 1);
    g.fillTriangle(6, 0, 0, 8, 12, 8);
    g.fillTriangle(0, 8, 12, 8, 6, 16);
    g.fillStyle(COLORS.white, 0.55);
    g.fillTriangle(6, 3, 3.5, 7, 8.5, 7);
    g.generateTexture('gem', 12, 16);
    g.clear();

    // орбитальный клинок — горизонтальное лезвие
    g.fillStyle(0x9beeff, 1);
    g.fillRoundedRect(0, 2, 30, 6, 3);
    g.fillStyle(COLORS.cyan, 1);
    g.fillRoundedRect(4, 3.5, 20, 3, 1.5);
    g.generateTexture('blade', 30, 10);
    g.clear();

    // частица
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(4, 4, 3);
    g.generateTexture('spark', 8, 8);
    g.clear();

    g.destroy();

    // сетка фона
    const grid = this.textures.createCanvas('grid', 256, 256);
    if (grid) {
      const ctx = grid.getContext();
      ctx.fillStyle = '#0b0e1a';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#1c2338';
      for (let i = 0; i < 256; i += 64) {
        ctx.fillRect(i, 0, 2, 256);
        ctx.fillRect(0, i, 256, 2);
      }
      ctx.fillStyle = '#2a3452';
      for (let x = 0; x <= 256; x += 64) {
        for (let y = 0; y <= 256; y += 64) ctx.fillRect(x - 2, y - 2, 4, 4);
      }
      grid.refresh();
    }

    // мягкое свечение
    const glow = this.textures.createCanvas('glow', 64, 64);
    if (glow) {
      const ctx = glow.getContext();
      const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      glow.refresh();
    }

    // виньетка
    const vg = this.textures.createCanvas('vignette', 512, 512);
    if (vg) {
      const ctx = vg.getContext();
      const grad = ctx.createRadialGradient(256, 256, 140, 256, 256, 320);
      grad.addColorStop(0, 'rgba(5,8,18,0)');
      grad.addColorStop(1, 'rgba(5,8,18,0.6)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);
      vg.refresh();
    }
  }
}
