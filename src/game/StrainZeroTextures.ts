import Phaser from 'phaser';
import { COLORS } from './config';

type Ctx = CanvasRenderingContext2D;

/**
 * STRAIN ZERO visual language v2.
 *
 * All art is baked once into CanvasTextures at boot/menu time. Runtime uses ordinary Phaser
 * Images/Sprites, so the richer microscopic look costs almost nothing per frame and carries no
 * external asset/license dependency. Silhouette and phone-size readability take priority over
 * microscopic realism.
 */
export function ensureStrainZeroTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('virus-player')) return;

  const make = (
    key: string,
    width: number,
    height: number,
    draw: (ctx: Ctx, width: number, height: number) => void
  ): void => {
    const texture = scene.textures.createCanvas(key, width, height);
    if (!texture) return;
    const ctx = texture.getContext();
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    draw(ctx, width, height);
    texture.refresh();
  };

  const rgba = (hex: string, alpha: number): string => {
    const value = hex.replace('#', '');
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const radial = (
    ctx: Ctx,
    x: number,
    y: number,
    radius: number,
    inner: string,
    middle: string,
    outer: string
  ): CanvasGradient => {
    const grad = ctx.createRadialGradient(x - radius * 0.28, y - radius * 0.32, radius * 0.08, x, y, radius);
    grad.addColorStop(0, inner);
    grad.addColorStop(0.55, middle);
    grad.addColorStop(1, outer);
    return grad;
  };

  // ---------------------------------------------------------------------------
  // PLAYER — OFELIYA / STRAIN-0
  // ---------------------------------------------------------------------------
  make('virus-player', 56, 56, (ctx) => {
    const c = 28;
    const membraneR = 17;

    // Protein spikes: alternating long/short gives a recognisable crown even at 1x phone scale.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const long = i % 2 === 0;
      const r0 = membraneR + 0.5;
      const r1 = long ? 25.5 : 22.5;
      const x0 = c + Math.cos(a) * r0;
      const y0 = c + Math.sin(a) * r0;
      const x1 = c + Math.cos(a) * r1;
      const y1 = c + Math.sin(a) * r1;

      ctx.strokeStyle = long ? 'rgba(255,102,196,0.95)' : 'rgba(126,255,166,0.78)';
      ctx.lineWidth = long ? 2.2 : 1.55;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      ctx.fillStyle = long ? '#ff6ec5' : '#8affae';
      ctx.beginPath();
      ctx.arc(x1, y1, long ? 2.05 : 1.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,244,236,0.5)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    // Envelope with real volume instead of a flat fill.
    ctx.fillStyle = radial(ctx, c, c, membraneR, '#a72a74', '#5b123f', '#25081f');
    ctx.beginPath();
    ctx.arc(c, c, membraneR, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,90,187,0.95)';
    ctx.lineWidth = 2.3;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,205,232,0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, 13.2, 0, Math.PI * 2);
    ctx.stroke();

    // Capsid facets.
    ctx.strokeStyle = 'rgba(255,177,217,0.28)';
    ctx.lineWidth = 0.85;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * 8.5, c + Math.sin(a) * 8.5);
      ctx.lineTo(c + Math.cos(a + 0.44) * 13, c + Math.sin(a + 0.44) * 13);
      ctx.stroke();
    }

    // RNA coil: deliberately bright green as the product's reward/replication colour.
    ctx.strokeStyle = '#8dffad';
    ctx.lineWidth = 2.1;
    ctx.shadowColor = 'rgba(125,255,160,0.45)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.moveTo(19, 29);
    ctx.bezierCurveTo(21, 18, 25, 18, 27, 28);
    ctx.bezierCurveTo(29, 38, 34, 37, 36, 25);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(255,244,236,0.72)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(20, 24);
    ctx.lineTo(27, 26);
    ctx.moveTo(21, 31);
    ctx.lineTo(29, 29);
    ctx.moveTo(26, 35);
    ctx.lineTo(34, 31);
    ctx.stroke();

    // Specular highlight keeps the mascot readable against dark plasma.
    ctx.fillStyle = 'rgba(255,244,236,0.28)';
    ctx.beginPath();
    ctx.ellipse(23, 21, 5.2, 3, -0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff4ec';
    ctx.beginPath();
    ctx.arc(22, 20, 1.4, 0, Math.PI * 2);
    ctx.fill();
  });

  make('viral-particle', 22, 14, (ctx) => {
    const grad = ctx.createLinearGradient(2, 7, 20, 7);
    grad.addColorStop(0, '#35102f');
    grad.addColorStop(0.55, '#a82972');
    grad.addColorStop(1, '#ff6ec5');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(2, 3, 17, 8, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,209,232,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#8dffad';
    ctx.beginPath();
    ctx.arc(14.5, 7, 2, 0, Math.PI * 2);
    ctx.fill();
  });

  // ---------------------------------------------------------------------------
  // IMMUNE CAST — every role owns a different silhouette.
  // ---------------------------------------------------------------------------
  make('immune-antibody', 38, 38, (ctx) => {
    ctx.shadowColor = 'rgba(143,232,255,0.45)';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = '#f4fdff';
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(19, 34);
    ctx.lineTo(19, 20);
    ctx.lineTo(8, 7);
    ctx.moveTo(19, 20);
    ctx.lineTo(30, 7);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#78dff7';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    for (const [x, y] of [[8, 7], [30, 7], [19, 34]] as const) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 4.2);
      glow.addColorStop(0, '#ffffff');
      glow.addColorStop(0.45, '#bff5ff');
      glow.addColorStop(1, 'rgba(99,220,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Runner/T-killer: biological cell, but with a bright leading immune synapse on +X.
  // Enemy.preUpdate rotates this texture toward the player, so direction is obvious in motion.
  make('immune-tcell', 44, 40, (ctx) => {
    const cX = 20;
    const cY = 20;
    ctx.fillStyle = radial(ctx, cX, cY, 17, '#f8ffff', '#bfeaf3', '#5f9bb0');
    ctx.beginPath();
    ctx.ellipse(cX, cY, 17, 15.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#dffaff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = radial(ctx, 16, 21, 9, '#728bad', '#405475', '#263650');
    ctx.beginPath();
    ctx.ellipse(16, 21, 9, 8, -0.25, 0, Math.PI * 2);
    ctx.fill();

    // Receptor fan: creates a spearhead silhouette without turning the cell into a spaceship.
    for (let i = -2; i <= 2; i++) {
      const y = cY + i * 4.3;
      const x0 = 34;
      const x1 = 40 - Math.abs(i) * 0.8;
      ctx.strokeStyle = 'rgba(143,232,255,0.95)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y + i * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x1, y + i * 0.45, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.beginPath();
    ctx.ellipse(15, 11, 5.5, 2.4, -0.45, 0, Math.PI * 2);
    ctx.fill();
  });

  make('immune-macrophage', 62, 62, (ctx) => {
    const pts = [
      [5, 31], [8, 21], [15, 18], [17, 9], [27, 12], [34, 5], [42, 14], [53, 14],
      [51, 25], [59, 31], [51, 38], [53, 49], [42, 48], [34, 58], [26, 50], [14, 52],
      [15, 42], [6, 39],
    ] as const;
    const last = pts[pts.length - 1];
    const first = pts[0];
    ctx.beginPath();
    ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = radial(ctx, 29, 27, 30, '#fff8ef', '#d9aa91', '#7d5264');
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,196,0.92)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = radial(ctx, 29, 31, 13, '#b976a2', '#6f426f', '#39284b');
    ctx.beginPath();
    ctx.ellipse(29, 31, 14, 10.5, 0.25, 0, Math.PI * 2);
    ctx.fill();

    const vesicles = [[16, 27, 3.2], [41, 21, 2.8], [43, 39, 3], [22, 43, 2.2]] as const;
    for (const [x, y, r] of vesicles) {
      ctx.fillStyle = 'rgba(255,248,235,0.54)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(119,73,99,0.45)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.ellipse(22, 17, 7, 2.8, -0.45, 0, Math.PI * 2);
    ctx.fill();
  });

  make('immune-prime', 94, 94, (ctx) => {
    const c = 47;
    // Aggressive lobed membrane.
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = 38 + Math.sin(a * 5) * 3.2 + Math.sin(a * 9) * 1.5;
      const x = c + Math.cos(a) * r;
      const y = c + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = radial(ctx, c, c, 42, '#ffffff', '#cdeff5', '#6d9fb0');
    ctx.fill();
    ctx.strokeStyle = '#a8f0ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Multi-lobed nucleus.
    const nuclei = [[37, 42, 14], [55, 36, 13], [57, 56, 14], [39, 59, 12]] as const;
    for (const [x, y, r] of nuclei) {
      ctx.fillStyle = radial(ctx, x, y, r, '#6983a5', '#334d70', '#1c2f4e');
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Receptor halo = boss readability at zoomed-out phone framing.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x0 = c + Math.cos(a) * 38;
      const y0 = c + Math.sin(a) * 38;
      const x1 = c + Math.cos(a) * 44;
      const y1 = c + Math.sin(a) * 44;
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.72)' : 'rgba(143,232,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x1, y1, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // ---------------------------------------------------------------------------
  // REWARD / BIOLOGICAL ENVIRONMENT
  // ---------------------------------------------------------------------------
  make('rna-fragment', 22, 28, (ctx) => {
    ctx.shadowColor = 'rgba(126,255,166,0.55)';
    ctx.shadowBlur = 5;
    ctx.strokeStyle = '#86ffaa';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(6, 3);
    ctx.bezierCurveTo(17, 7, 17, 11, 6, 14);
    ctx.bezierCurveTo(-1, 18, 7, 22, 16, 25);
    ctx.stroke();
    ctx.strokeStyle = '#fff4ec';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(16, 3);
    ctx.bezierCurveTo(5, 7, 5, 11, 16, 14);
    ctx.bezierCurveTo(23, 18, 15, 22, 6, 25);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(126,255,166,0.65)';
    ctx.lineWidth = 0.9;
    for (let y = 6; y <= 22; y += 4) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(14, y + 1.5);
      ctx.stroke();
    }
  });

  make('erythrocyte', 92, 64, (ctx) => {
    const grad = ctx.createRadialGradient(34, 22, 4, 46, 32, 42);
    grad.addColorStop(0, '#ff7382');
    grad.addColorStop(0.4, '#d84458');
    grad.addColorStop(0.78, '#8f2438');
    grad.addColorStop(1, '#4e1222');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(46, 32, 43, 27, -0.08, 0, Math.PI * 2);
    ctx.fill();

    // Biconcave depression.
    const cup = ctx.createRadialGradient(46, 32, 1, 46, 32, 20);
    cup.addColorStop(0, 'rgba(73,13,31,0.95)');
    cup.addColorStop(0.48, 'rgba(111,23,42,0.82)');
    cup.addColorStop(1, 'rgba(255,96,111,0)');
    ctx.fillStyle = cup;
    ctx.beginPath();
    ctx.ellipse(46, 32, 22, 12, -0.08, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,142,150,0.62)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(46, 32, 41, 25, -0.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,204,205,0.16)';
    ctx.beginPath();
    ctx.ellipse(32, 19, 18, 5.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
  });

  make('host-cell-shadow', 112, 112, (ctx) => {
    const c = 56;
    const body = ctx.createRadialGradient(41, 36, 5, c, c, 50);
    body.addColorStop(0, 'rgba(222,102,151,0.62)');
    body.addColorStop(0.48, 'rgba(134,43,86,0.52)');
    body.addColorStop(1, 'rgba(67,17,49,0.2)');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(c, c, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,134,177,0.58)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,196,216,0.17)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, 43, 0, Math.PI * 2);
    ctx.stroke();

    const nucleus = ctx.createRadialGradient(50, 52, 2, 56, 58, 22);
    nucleus.addColorStop(0, 'rgba(113,54,111,0.85)');
    nucleus.addColorStop(0.7, 'rgba(61,28,75,0.82)');
    nucleus.addColorStop(1, 'rgba(28,15,43,0.6)');
    ctx.fillStyle = nucleus;
    ctx.beginPath();
    ctx.ellipse(57, 58, 23, 19, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,159,210,0.24)';
    ctx.stroke();

    // Organelles / vesicles.
    const organelles = [[31, 45, 4], [79, 42, 3.2], [79, 73, 4.4], [36, 77, 3.4], [67, 29, 2.8]] as const;
    for (const [x, y, r] of organelles) {
      ctx.fillStyle = 'rgba(255,154,187,0.18)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,205,221,0.2)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  });

  make('host-cell-infection', 112, 112, (ctx) => {
    const c = 56;
    const glow = ctx.createRadialGradient(c, c, 2, c, c, 43);
    glow.addColorStop(0, 'rgba(137,255,169,0.54)');
    glow.addColorStop(0.5, 'rgba(255,79,181,0.18)');
    glow.addColorStop(1, 'rgba(126,255,166,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c, c, 45, 0, Math.PI * 2);
    ctx.fill();

    // Replication foci and branching infected membrane paths.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.28;
      const inner = 12 + (i % 3) * 4;
      const outer = 35 + (i % 2) * 5;
      ctx.strokeStyle = i % 2 ? 'rgba(126,255,166,0.72)' : 'rgba(255,99,194,0.62)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
      ctx.quadraticCurveTo(
        c + Math.cos(a + 0.22) * ((inner + outer) * 0.55),
        c + Math.sin(a + 0.22) * ((inner + outer) * 0.55),
        c + Math.cos(a) * outer,
        c + Math.sin(a) * outer
      );
      ctx.stroke();
      ctx.fillStyle = '#8dffad';
      ctx.beginPath();
      ctx.arc(c + Math.cos(a) * outer, c + Math.sin(a) * outer, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  make('membrane-fragment', 26, 18, (ctx) => {
    const grad = ctx.createLinearGradient(2, 9, 24, 9);
    grad.addColorStop(0, 'rgba(255,90,187,0)');
    grad.addColorStop(0.3, 'rgba(255,105,190,0.9)');
    grad.addColorStop(0.75, 'rgba(126,255,166,0.78)');
    grad.addColorStop(1, 'rgba(126,255,166,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(2, 12);
    ctx.quadraticCurveTo(12, 3, 24, 9);
    ctx.stroke();
  });

  make('bio-spark', 14, 14, (ctx) => {
    const glow = ctx.createRadialGradient(7, 7, 0, 7, 7, 7);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.24, 'rgba(255,255,255,0.92)');
    glow.addColorStop(0.55, 'rgba(255,140,205,0.5)');
    glow.addColorStop(1, 'rgba(255,79,181,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 14, 14);
  });

  // Critical mutation emblems are generated even before the UI adopts them; this keeps the art
  // contract explicit and lets menus/results use the same symbols later.
  make('mutation-prism', 64, 64, (ctx) => {
    ctx.strokeStyle = '#ffd56a';
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(32 + Math.cos(a) * 12, 32 + Math.sin(a) * 12);
      ctx.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27);
      ctx.stroke();
    }
    ctx.fillStyle = radial(ctx, 32, 32, 16, '#fff4ec', '#ff78c8', '#681744');
    ctx.beginPath();
    ctx.arc(32, 32, 15, 0, Math.PI * 2);
    ctx.fill();
  });

  make('mutation-halo', 64, 64, (ctx) => {
    ctx.strokeStyle = '#ffd56a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(32, 32, 24, -0.2, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 24, 1.7, 3.15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 24, 3.65, 5.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(32, 32, 24, 5.55, 6.15);
    ctx.stroke();
    ctx.fillStyle = '#fff4ec';
    ctx.beginPath();
    ctx.arc(32, 32, 7, 0, Math.PI * 2);
    ctx.fill();
  });

  make('mutation-singularity', 64, 64, (ctx) => {
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 29);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.18, '#8dffad');
    glow.addColorStop(0.4, '#ff4fb5');
    glow.addColorStop(0.72, 'rgba(155,109,255,0.45)');
    glow.addColorStop(1, 'rgba(155,109,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(255,244,236,0.78)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(32, 32, 25 - i * 5, 11 - i * 2, i * 0.65, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // ---------------------------------------------------------------------------
  // PLASMA BACKDROP — baked capillary flow, no shader required.
  // ---------------------------------------------------------------------------
  const plasma = scene.textures.createCanvas('blood-plasma', 256, 256);
  if (plasma) {
    const ctx = plasma.getContext();
    const bg = ctx.createLinearGradient(0, 0, 0, 256);
    bg.addColorStop(0, '#16070f');
    bg.addColorStop(0.5, '#250a14');
    bg.addColorStop(1, '#16070f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 7; i++) {
      const y = 18 + i * 38;
      ctx.strokeStyle = i % 2
        ? 'rgba(255,71,96,0.035)'
        : 'rgba(255,126,145,0.025)';
      ctx.lineWidth = 12 + (i % 3) * 7;
      ctx.beginPath();
      ctx.moveTo(-20, y);
      ctx.bezierCurveTo(62, y - 25, 194, y + 25, 276, y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,150,164,0.035)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    for (let i = 0; i < 22; i++) {
      const x = (i * 83 + 17) % 256;
      const y = (i * 47 + 29) % 256;
      const r = 7 + ((i * 13) % 23);
      for (const ox of [-256, 0, 256]) {
        ctx.beginPath();
        ctx.arc(x + ox, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = i % 4 === 0 ? 'rgba(255,92,119,0.065)' : 'rgba(185,44,66,0.038)';
        ctx.lineWidth = 1 + (i % 2) * 0.6;
        ctx.stroke();
      }
    }

    for (let i = 0; i < 42; i++) {
      const x = (i * 37 + 11) % 256;
      const y = (i * 71 + 5) % 256;
      const a = 0.018 + (i % 4) * 0.008;
      ctx.fillStyle = `rgba(255,190,199,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + (i % 3) * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }

    const sheen = ctx.createLinearGradient(0, 0, 0, 256);
    sheen.addColorStop(0, 'rgba(255,97,128,0.025)');
    sheen.addColorStop(0.5, 'rgba(0,0,0,0)');
    sheen.addColorStop(1, 'rgba(255,97,128,0.025)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, 256, 256);
    plasma.refresh();
  }

  // Keep a tiny colour-token side effect so TypeScript does not consider COLORS an accidental
  // dependency if this file is later simplified. It also documents the canonical viral accent.
  void rgba('#ff4fb5', ((COLORS.virus & 0xff) / 255) * 0 + 1);
}
