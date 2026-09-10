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

    // K4 БОСС «ОРБИТАЛЬНАЯ ФОРТЕЦА» — кольцо сегментов вокруг холодного ядра.
    g.fillStyle(0x141026, 1);
    g.fillCircle(28, 28, 20);
    g.lineStyle(4, COLORS.purple, 1);
    for (let i = 0; i < 3; i++) {
      const a = i * ((Math.PI * 2) / 3) + 0.3;
      g.beginPath();
      g.arc(28, 28, 24, a, a + 1.5);
      g.strokePath();
    }
    g.lineStyle(1.5, COLORS.purple, 0.5);
    g.strokeCircle(28, 28, 17);
    g.fillStyle(0x241a40, 1);
    g.fillCircle(28, 28, 10);
    g.lineStyle(2, COLORS.white, 0.8);
    g.strokeCircle(28, 28, 6);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(28, 28, 3);
    g.generateTexture('boss-orbital', 56, 56);
    g.clear();

    // K4 БОСС «РАЗДЕЛЯЮЩЕЕ ЯДРО» — красное ядро с зигзагом-трещиной пополам.
    g.fillStyle(0x2a0d14, 1);
    g.fillCircle(28, 28, 24);
    g.lineStyle(3, COLORS.red, 1);
    g.strokeCircle(28, 28, 24);
    g.lineStyle(1.5, COLORS.red, 0.5);
    g.strokeCircle(28, 28, 17);
    g.fillStyle(0x3a1018, 1);
    g.fillCircle(28, 28, 13);
    // трещина — зигзаг слева направо
    g.lineStyle(2.5, COLORS.white, 0.85);
    g.beginPath();
    g.moveTo(14, 22);
    g.lineTo(24, 28);
    g.lineTo(20, 34);
    g.lineTo(32, 30);
    g.lineTo(30, 38);
    g.lineTo(42, 34);
    g.strokePath();
    g.fillStyle(COLORS.red, 0.95);
    g.fillCircle(28, 28, 5);
    g.generateTexture('boss-splitter', 56, 56);
    g.clear();

    // K4 ОСКОЛОК БОССА — половинка расколотого ядра (быстрая, злая).
    g.fillStyle(0x2a0d14, 1);
    g.fillPoints(
      [
        { x: 20, y: 4 },
        { x: 36, y: 14 },
        { x: 32, y: 34 },
        { x: 12, y: 36 },
        { x: 6, y: 16 },
      ],
      true
    );
    g.lineStyle(2.5, COLORS.red, 1);
    g.strokePoints(
      [
        { x: 20, y: 4 },
        { x: 36, y: 14 },
        { x: 32, y: 34 },
        { x: 12, y: 36 },
        { x: 6, y: 16 },
      ],
      true
    );
    g.lineStyle(1.5, COLORS.white, 0.55);
    g.beginPath();
    g.moveTo(8, 14);
    g.lineTo(18, 20);
    g.lineTo(14, 28);
    g.lineTo(26, 26);
    g.strokePath();
    g.fillStyle(COLORS.red, 0.95);
    g.fillCircle(20, 20, 4);
    g.generateTexture('boss-shard', 40, 40);
    g.clear();

    // K2 РАЗДЕЛИТЕЛЬ — зелёный ромб со «швом», который треснет при смерти.
    g.fillStyle(0x0e2417, 1);
    g.fillPoints(
      [
        { x: 12, y: 2 },
        { x: 22, y: 12 },
        { x: 12, y: 22 },
        { x: 2, y: 12 },
      ],
      true
    );
    g.lineStyle(2, COLORS.green, 1);
    g.strokePoints(
      [
        { x: 12, y: 2 },
        { x: 22, y: 12 },
        { x: 12, y: 22 },
        { x: 2, y: 12 },
      ],
      true
    );
    g.lineStyle(1.5, COLORS.green, 0.8);
    g.beginPath();
    g.moveTo(12, 4);
    g.lineTo(9, 9);
    g.lineTo(14, 13);
    g.lineTo(11, 18);
    g.strokePath();
    g.fillStyle(COLORS.green, 0.9);
    g.fillCircle(12, 12, 2);
    g.generateTexture('enemy-splitter', 24, 24);
    g.clear();

    // K2 МИНЬОН — маленький зелёный сгусток (потомок разделителя).
    g.fillStyle(0x0e2417, 1);
    g.fillCircle(8, 8, 7);
    g.lineStyle(1.5, COLORS.green, 0.95);
    g.strokeCircle(8, 8, 6);
    g.fillStyle(COLORS.green, 1);
    g.fillCircle(8, 8, 3);
    g.generateTexture('enemy-minion', 16, 16);
    g.clear();

    // K2 ЩИТОНОС — синий, с яркой дугой-щитом СЕРЕДИНЫ (в сторону игрока).
    // «Лицом» считается +X текстуры (вращается к цели в Enemy.preUpdate).
    g.fillStyle(0x0a1a2e, 1);
    g.fillPoints(
      [
        { x: 13, y: 3 },
        { x: 22, y: 9 },
        { x: 20, y: 18 },
        { x: 6, y: 18 },
        { x: 4, y: 9 },
      ],
      true
    );
    g.lineStyle(2, 0x4f9dff, 1);
    g.strokePoints(
      [
        { x: 13, y: 3 },
        { x: 22, y: 9 },
        { x: 20, y: 18 },
        { x: 6, y: 18 },
        { x: 4, y: 9 },
      ],
      true
    );
    g.fillStyle(0x4f9dff, 0.9);
    g.fillCircle(10, 11, 2.5);
    // щит — дуга справа (лицо)
    g.lineStyle(3.5, COLORS.cyan, 0.95);
    g.beginPath();
    g.arc(13, 11, 10, -0.9, 0.9);
    g.strokePath();
    g.lineStyle(1.5, COLORS.white, 0.5);
    g.beginPath();
    g.arc(13, 11, 10, -0.7, 0.7);
    g.strokePath();
    g.generateTexture('enemy-shield', 26, 26);
    g.clear();

    // K2 СНИПЕР — фиолетовый «глаз» в рамке, прицелится и выстрелит.
    g.fillStyle(0x170e2e, 1);
    g.fillPoints(
      [
        { x: 12, y: 2 },
        { x: 22, y: 12 },
        { x: 12, y: 22 },
        { x: 2, y: 12 },
      ],
      true
    );
    g.lineStyle(2, COLORS.purple, 1);
    g.strokePoints(
      [
        { x: 12, y: 2 },
        { x: 22, y: 12 },
        { x: 12, y: 22 },
        { x: 2, y: 12 },
      ],
      true
    );
    g.fillStyle(0x2a1650, 1);
    g.fillCircle(12, 12, 5);
    g.lineStyle(1.5, COLORS.white, 0.7);
    g.strokeCircle(12, 12, 5);
    g.fillStyle(COLORS.purple, 1);
    g.fillCircle(12, 12, 2.5);
    // «прицел» — линия вправо (сторона выстрела)
    g.lineStyle(1.5, COLORS.white, 0.5);
    g.beginPath();
    g.moveTo(17, 12);
    g.lineTo(23, 12);
    g.strokePath();
    g.generateTexture('enemy-sniper', 24, 24);
    g.clear();

    // K2 снаряд снайпера — розовая капсула (в сторону игрока).
    g.fillStyle(0xff9dcf, 1);
    g.fillRoundedRect(0, 0, 12, 6, 3);
    g.fillStyle(COLORS.white, 0.8);
    g.fillRoundedRect(3, 1.5, 6, 3, 1.5);
    g.generateTexture('foebullet', 12, 6);
    g.clear();

    // K5 БОМБЁР — тёмная сфера с оранжевыми кольцами и горящим ядром.
    g.fillStyle(0x241206, 1);
    g.fillCircle(14, 14, 12);
    g.lineStyle(2, COLORS.orange, 0.9);
    g.strokeCircle(14, 14, 12);
    g.lineStyle(1.5, COLORS.orange, 0.5);
    g.strokeCircle(14, 14, 8);
    g.fillStyle(0x3a1c08, 1);
    g.fillCircle(14, 14, 5.5);
    g.fillStyle(COLORS.orange, 1);
    g.fillCircle(14, 14, 3.5);
    g.fillStyle(COLORS.white, 0.9);
    g.fillCircle(14, 14, 1.5);
    g.generateTexture('enemy-bomber', 28, 28);
    g.clear();

    // K5 МИНА — тёмный шар с шипами и красным «предохранительным» огоньком.
    g.fillStyle(0x180d14, 1);
    g.fillCircle(12, 12, 8);
    g.lineStyle(2, 0xff5577, 0.9);
    g.strokeCircle(12, 12, 8);
    // шипы — 6 треугольников по окружности
    g.fillStyle(0x2a1520, 1);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = 12 + Math.cos(a) * 8;
      const y = 12 + Math.sin(a) * 8;
      const x2 = 12 + Math.cos(a) * 12;
      const y2 = 12 + Math.sin(a) * 12;
      g.fillTriangle(x - Math.sin(a) * 2.2, y + Math.cos(a) * 2.2, x + Math.sin(a) * 2.2, y - Math.cos(a) * 2.2, x2, y2);
    }
    g.fillStyle(0xff5577, 1);
    g.fillCircle(12, 12, 3);
    g.fillStyle(COLORS.white, 0.85);
    g.fillCircle(12, 12, 1.3);
    g.generateTexture('enemy-mine', 24, 24);
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

    // Фоновые системные глифы: намеренно тонкие — AtmosphereSystem держит их почти прозрачными.
    g.lineStyle(2, COLORS.cyan, 1);
    for (let i = 0; i < 6; i++) {
      const a = i * (Math.PI / 3) + 0.08;
      g.beginPath();
      g.arc(48, 48, 38, a, a + 0.68);
      g.strokePath();
    }
    g.lineStyle(1, COLORS.white, 0.7);
    g.strokeCircle(48, 48, 26);
    g.fillStyle(COLORS.cyan, 1);
    g.fillCircle(48, 10, 2);
    g.fillCircle(86, 48, 2);
    g.fillCircle(48, 86, 2);
    g.fillCircle(10, 48, 2);
    g.generateTexture('atmo-ring', 96, 96);
    g.clear();

    g.lineStyle(2, COLORS.purple, 1);
    g.beginPath();
    g.moveTo(8, 18);
    g.lineTo(30, 18);
    g.lineTo(30, 38);
    g.lineTo(52, 38);
    g.lineTo(52, 16);
    g.lineTo(82, 16);
    g.moveTo(16, 76);
    g.lineTo(38, 76);
    g.lineTo(38, 56);
    g.lineTo(68, 56);
    g.lineTo(68, 78);
    g.lineTo(88, 78);
    g.strokePath();
    g.fillStyle(COLORS.purple, 1);
    g.fillCircle(8, 18, 3);
    g.fillCircle(52, 38, 3);
    g.fillCircle(82, 16, 3);
    g.fillCircle(16, 76, 3);
    g.fillCircle(68, 56, 3);
    g.fillCircle(88, 78, 3);
    g.generateTexture('atmo-circuit', 96, 96);
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
