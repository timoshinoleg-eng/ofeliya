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

    // ЯДРО OFELIYA: круглая friendly-форма, сегментированное внешнее кольцо и белое ядро.
    g.fillStyle(0x071321, 1);
    g.fillCircle(14, 14, 13);
    g.lineStyle(2.5, COLORS.cyan, 1);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + 0.12;
      g.beginPath();
      g.arc(14, 14, 12, a, a + 1.05);
      g.strokePath();
    }
    g.lineStyle(1.5, COLORS.cyan, 0.45);
    g.strokeCircle(14, 14, 8);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(14, 14, 4.5);
    g.fillStyle(COLORS.cyan, 0.95);
    g.fillCircle(14, 3, 1.5);
    g.fillCircle(25, 14, 1.5);
    g.fillCircle(14, 25, 1.5);
    g.fillCircle(3, 14, 1.5);
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

    // ШУМ: почти круг, но с рваным/асимметричным контуром и сломанным ядром.
    g.fillStyle(0x351027, 1);
    g.fillPoints(
      [
        { x: 12, y: 1 },
        { x: 20, y: 4 },
        { x: 23, y: 11 },
        { x: 20, y: 20 },
        { x: 13, y: 23 },
        { x: 5, y: 20 },
        { x: 1, y: 13 },
        { x: 4, y: 5 },
      ],
      true
    );
    g.lineStyle(2, COLORS.magenta, 1);
    g.strokePoints(
      [
        { x: 12, y: 1 },
        { x: 20, y: 4 },
        { x: 23, y: 11 },
        { x: 20, y: 20 },
        { x: 13, y: 23 },
        { x: 5, y: 20 },
        { x: 1, y: 13 },
        { x: 4, y: 5 },
      ],
      true
    );
    g.lineStyle(1.5, COLORS.magenta, 0.6);
    g.beginPath();
    g.arc(12, 12, 6, -0.25, 1.7);
    g.strokePath();
    g.beginPath();
    g.arc(12, 12, 6, 2.15, 4.35);
    g.strokePath();
    g.fillStyle(COLORS.magenta, 1);
    g.fillCircle(10, 12, 2.5);
    g.fillRect(13, 9, 3, 6);
    g.generateTexture('enemy-swarm', 24, 24);
    g.clear();

    // ИМПУЛЬС: вытянутый острый клин с разорванным хвостом — читается как скорость.
    const runnerPts = [
      { x: 23, y: 12 },
      { x: 5, y: 2 },
      { x: 8, y: 9 },
      { x: 1, y: 12 },
      { x: 8, y: 15 },
      { x: 5, y: 22 },
    ];
    g.fillStyle(0x3a2410, 1);
    g.fillPoints(runnerPts, true);
    g.lineStyle(2, COLORS.orange, 1);
    g.strokePoints(runnerPts, true);
    g.fillStyle(COLORS.orange, 0.95);
    g.fillTriangle(20, 12, 11, 8.5, 11, 15.5);
    g.lineStyle(1.5, COLORS.orange, 0.55);
    g.beginPath();
    g.moveTo(2, 6);
    g.lineTo(7, 9);
    g.moveTo(2, 18);
    g.lineTo(7, 15);
    g.strokePath();
    g.generateTexture('enemy-runner', 24, 24);
    g.clear();

    // РАЗРЫВ: тяжёлая угловатая форма с вырезанным центром и усиленными углами.
    const brutePts = [
      { x: 6, y: 1 },
      { x: 24, y: 1 },
      { x: 29, y: 6 },
      { x: 29, y: 24 },
      { x: 24, y: 29 },
      { x: 6, y: 29 },
      { x: 1, y: 24 },
      { x: 1, y: 6 },
    ];
    g.fillStyle(0x28113f, 1);
    g.fillPoints(brutePts, true);
    g.lineStyle(2.5, COLORS.purple, 1);
    g.strokePoints(brutePts, true);
    g.fillStyle(0x0b0e1a, 1);
    g.fillRect(9, 9, 12, 12);
    g.lineStyle(2, COLORS.purple, 0.8);
    g.strokeRect(10, 10, 10, 10);
    g.fillStyle(COLORS.purple, 1);
    g.fillRect(3, 3, 6, 3);
    g.fillRect(21, 3, 6, 3);
    g.fillRect(3, 24, 6, 3);
    g.fillRect(21, 24, 6, 3);
    g.generateTexture('enemy-brute', 30, 30);
    g.clear();

    // АНОМАЛИЯ: отдельный декоративный overlay для элит, не новый enemy family.
    g.lineStyle(2, COLORS.gold, 0.95);
    for (let i = 0; i < 4; i++) {
      const a = i * (Math.PI / 2) + 0.1;
      g.beginPath();
      g.arc(21, 21, 18, a, a + 0.92);
      g.strokePath();
    }
    g.lineStyle(1, COLORS.white, 0.55);
    g.strokeCircle(21, 21, 14);
    g.fillStyle(COLORS.gold, 1);
    g.fillTriangle(21, 0, 18, 5, 24, 5);
    g.fillTriangle(42, 21, 37, 18, 37, 24);
    g.fillTriangle(21, 42, 18, 37, 24, 37);
    g.fillTriangle(0, 21, 5, 18, 5, 24);
    g.generateTexture('elite-ring', 42, 42);
    g.clear();

    // босс
    g.fillStyle(0x3a0d18, 1);
    g.fillCircle(28, 28, 27);
    g.lineStyle(3, COLORS.red, 1);
    g.strokeCircle(28, 28, 25);
    g.lineStyle(2, COLORS.red, 0.6);
    for (let i = 0; i < 6; i++) {
      const a = i * (Math.PI / 3) + 0.1;
      g.beginPath();
      g.arc(28, 28, 18, a, a + 0.72);
      g.strokePath();
    }
    g.fillStyle(COLORS.red, 1);
    g.fillCircle(28, 28, 8);
    g.fillStyle(COLORS.white, 0.85);
    g.fillCircle(28, 28, 3);
    g.generateTexture('boss', 56, 56);
    g.clear();

    // фрагмент данных — ромб
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

    this.makeIcons(g);

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

  /**
   * Иконки улучшений: ключ текстуры `up-<id>` (id из UpgradeSystem).
   * Рисуются кодом, 40×40 — те же правила, что и для остальных спрайтов:
   * никаких внешних ассетов и лицензионных вопросов.
   * UI проверяет существование текстуры, так что забытая иконка не ломает бой.
   */
  private makeIcons(g: Phaser.GameObjects.Graphics): void {
    const put = (id: string, draw: () => void): void => {
      g.clear();
      draw();
      g.generateTexture(`up-${id}`, 40, 40);
      g.clear();
    };
    const solid = (c: number): void => {
      g.fillStyle(c, 1);
    };
    const line = (c: number, w: number, a = 1): void => {
      g.lineStyle(w, c, a);
    };
    const bolt = (pts: number[]): void => {
      const p: Phaser.Types.Math.Vector2Like[] = [];
      for (let i = 0; i < pts.length; i += 2) p.push({ x: pts[i], y: pts[i + 1] });
      g.fillPoints(p, true);
    };

    // урон — стрелка вверх
    put('dmg', () => {
      solid(COLORS.orange);
      g.fillTriangle(20, 4, 33, 19, 7, 19);
      g.fillRect(15, 17, 10, 19);
    });

    // скорострельность — молния
    put('rate', () => {
      solid(COLORS.cyan);
      bolt([25, 3, 10, 21, 19, 21, 15, 37, 30, 17, 21, 17]);
    });

    // +1 снаряд — залп из трёх
    put('multi', () => {
      solid(COLORS.cyan);
      g.fillRoundedRect(6, 8, 26, 6, 3);
      g.fillRoundedRect(6, 17, 30, 6, 3);
      g.fillRoundedRect(6, 26, 20, 6, 3);
    });

    // пробивание — стрела сквозь препятствие
    put('pierce', () => {
      line(COLORS.cyan, 3);
      g.beginPath();
      g.moveTo(4, 20);
      g.lineTo(33, 20);
      g.strokePath();
      solid(COLORS.cyan);
      g.fillTriangle(37, 20, 26, 13, 26, 27);
      g.fillStyle(0x0b0e1a, 1);
      g.fillRect(15, 11, 5, 18);
    });

    // скорость — линии и стрелка
    put('speed', () => {
      solid(COLORS.green);
      g.fillRoundedRect(5, 8, 22, 5, 2.5);
      g.fillRoundedRect(5, 17, 17, 5, 2.5);
      g.fillRoundedRect(5, 26, 12, 5, 2.5);
      g.fillTriangle(36, 20, 27, 14, 27, 26);
    });

    // прочность — сердце
    put('hp', () => {
      solid(COLORS.red);
      g.fillCircle(14, 15, 9);
      g.fillCircle(26, 15, 9);
      g.fillTriangle(5.5, 17, 34.5, 17, 20, 35);
    });

    // магнит — подкова
    put('magnet', () => {
      line(COLORS.purple, 6);
      g.beginPath();
      g.arc(20, 22, 13, Math.PI, Math.PI * 2);
      g.strokePath();
      solid(COLORS.purple);
      g.fillRect(7, 22, 6, 11);
      g.fillRect(27, 22, 6, 11);
    });

    // орбитальный клинок — орбита с лезвием
    put('orbit', () => {
      line(COLORS.cyan, 2.5, 0.85);
      g.strokeCircle(20, 20, 13);
      solid(COLORS.cyan);
      g.fillCircle(20, 6, 5);
      g.fillCircle(20, 20, 3.5);
    });

    // нова — вспышка
    put('nova', () => {
      line(COLORS.orange, 4);
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI * 2) / 8;
        g.beginPath();
        g.moveTo(20 + Math.cos(a) * 6, 20 + Math.sin(a) * 6);
        g.lineTo(20 + Math.cos(a) * 17, 20 + Math.sin(a) * 17);
        g.strokePath();
      }
      solid(COLORS.orange);
      g.fillCircle(20, 20, 4);
    });

    // регенерация — шевроны в круге
    put('regen', () => {
      line(COLORS.green, 2.5, 0.85);
      g.strokeCircle(20, 20, 14);
      line(COLORS.green, 3.5);
      g.beginPath();
      g.moveTo(11, 21);
      g.lineTo(20, 13);
      g.lineTo(29, 21);
      g.strokePath();
      g.beginPath();
      g.moveTo(11, 28);
      g.lineTo(20, 20);
      g.lineTo(29, 28);
      g.strokePath();
    });

    // ремонт — крест в круге
    put('heal', () => {
      line(COLORS.green, 3);
      g.strokeCircle(20, 20, 14);
      solid(COLORS.green);
      g.fillRect(17, 9, 6, 22);
      g.fillRect(9, 17, 22, 6);
    });
  }
}
