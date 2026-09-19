import Phaser from 'phaser';

type Ctx = CanvasRenderingContext2D;

function roundedPanel(ctx: Ctx, w: number, h: number, top: string, bottom: string): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, top);
  bg.addColorStop(1, bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
}

function vignette(ctx: Ctx, w: number, h: number): void {
  const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.18, w / 2, h / 2, Math.max(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(1,2,8,0.72)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

function make(
  scene: Phaser.Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: Ctx, width: number, height: number) => void
): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) return;
  const ctx = texture.getContext();
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw(ctx, width, height);
  texture.refresh();
}

/**
 * Lightweight cinematic key art baked at runtime.
 * Keeps the repo asset-free while giving stage/boss reveals an illustrated frame rather than
 * relying only on gameplay circles and text.
 */
export function ensureCinematicTextures(scene: Phaser.Scene): void {
  make(scene, 'cinematic-heart', 420, 240, (ctx, w, h) => {
    roundedPanel(ctx, w, h, '#2b0716', '#09030a');

    // Layered myocardial fibres.
    for (let i = 0; i < 18; i++) {
      const y = 18 + i * 13;
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,97,139,0.30)' : 'rgba(173,52,91,0.20)';
      ctx.lineWidth = i % 3 === 0 ? 3 : 1.6;
      ctx.beginPath();
      ctx.moveTo(-20, y + Math.sin(i) * 7);
      ctx.bezierCurveTo(w * 0.25, y - 24, w * 0.65, y + 28, w + 20, y - 4);
      ctx.stroke();
    }

    // Heart chamber silhouette.
    ctx.save();
    ctx.translate(w * 0.58, h * 0.5);
    ctx.fillStyle = 'rgba(92,8,35,0.96)';
    ctx.strokeStyle = 'rgba(255,124,160,0.88)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 74);
    ctx.bezierCurveTo(-18, 48, -82, 18, -72, -33);
    ctx.bezierCurveTo(-66, -72, -18, -78, 0, -46);
    ctx.bezierCurveTo(20, -78, 70, -72, 77, -31);
    ctx.bezierCurveTo(87, 17, 30, 50, 0, 74);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const core = ctx.createRadialGradient(-8, -8, 4, 0, 0, 70);
    core.addColorStop(0, 'rgba(255,226,220,0.82)');
    core.addColorStop(0.22, 'rgba(255,77,133,0.40)');
    core.addColorStop(1, 'rgba(255,50,100,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-90, -90, 180, 180);

    // Major vessel arcs.
    ctx.strokeStyle = 'rgba(255,181,195,0.66)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(-18, -52);
    ctx.bezierCurveTo(-22, -90, -52, -101, -75, -92);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(126,21,57,0.95)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(24, -52);
    ctx.bezierCurveTo(36, -92, 68, -99, 88, -77);
    ctx.stroke();
    ctx.restore();

    // Blood cells crossing foreground for scale.
    for (const [x, y, r, a] of [
      [58, 48, 24, -0.2],
      [103, 188, 18, 0.45],
      [356, 54, 21, 0.25],
      [332, 190, 27, -0.35],
    ] as const) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(137,27,50,0.72)';
      ctx.strokeStyle = 'rgba(230,91,112,0.48)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.45, r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(48,5,20,0.38)';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.62, r * 0.27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    vignette(ctx, w, h);
  });

  make(scene, 'cinematic-immune-prime', 420, 190, (ctx, w, h) => {
    roundedPanel(ctx, w, h, '#07121b', '#140713');
    // Immune halo.
    const halo = ctx.createRadialGradient(w * 0.31, h * 0.5, 8, w * 0.31, h * 0.5, 95);
    halo.addColorStop(0, 'rgba(255,255,255,0.55)');
    halo.addColorStop(0.38, 'rgba(124,224,248,0.24)');
    halo.addColorStop(1, 'rgba(62,190,230,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(20, 0, 220, h);

    ctx.save();
    ctx.translate(w * 0.31, h * 0.5);
    ctx.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r = 62 + Math.sin(a * 5) * 7 + Math.sin(a * 9) * 3;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(214,246,251,0.92)';
    ctx.strokeStyle = 'rgba(130,235,255,0.98)';
    ctx.lineWidth = 4;
    ctx.fill();
    ctx.stroke();
    for (const [x, y, r] of [[-20,-9,24],[20,-19,22],[22,23,24],[-17,27,21]] as const) {
      const n = ctx.createRadialGradient(x - 7, y - 7, 2, x, y, r);
      n.addColorStop(0, '#718cac');
      n.addColorStop(1, '#162d4a');
      ctx.fillStyle = n;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Directional pressure lines.
    for (let i = 0; i < 7; i++) {
      ctx.strokeStyle = `rgba(143,232,255,${0.15 + i * 0.035})`;
      ctx.lineWidth = 1.2 + i * 0.16;
      ctx.beginPath();
      ctx.moveTo(w * 0.53 + i * 10, 28);
      ctx.lineTo(w - 22, 55 + i * 16);
      ctx.stroke();
    }
    vignette(ctx, w, h);
  });

  make(scene, 'cinematic-cardiac-titan', 420, 190, (ctx, w, h) => {
    roundedPanel(ctx, w, h, '#250612', '#08030a');
    for (let i = 0; i < 15; i++) {
      const y = 10 + i * 14;
      ctx.strokeStyle = i % 2 ? 'rgba(145,33,67,0.28)' : 'rgba(255,80,123,0.24)';
      ctx.lineWidth = i % 2 ? 2 : 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(w * 0.28, y + 22, w * 0.62, y - 18, w, y + 7);
      ctx.stroke();
    }

    const cx = w * 0.31;
    const cy = h * 0.5;
    const aura = ctx.createRadialGradient(cx, cy, 6, cx, cy, 86);
    aura.addColorStop(0, 'rgba(255,234,226,0.72)');
    aura.addColorStop(0.25, 'rgba(255,56,112,0.34)');
    aura.addColorStop(1, 'rgba(255,40,95,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(cx - 95, cy - 95, 190, 190);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#68112f';
    ctx.strokeStyle = '#ff6b9f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 61);
    ctx.bezierCurveTo(-20, 41, -64, 17, -58, -25);
    ctx.bezierCurveTo(-53, -57, -14, -64, 2, -37);
    ctx.bezierCurveTo(21, -62, 62, -54, 65, -20);
    ctx.bezierCurveTo(70, 17, 29, 43, 0, 61);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.72)' : 'rgba(255,82,134,0.95)';
      ctx.lineWidth = i % 2 ? 2 : 3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 65, Math.sin(a) * 65);
      ctx.lineTo(Math.cos(a) * 82, Math.sin(a) * 82);
      ctx.stroke();
    }
    ctx.restore();

    // ECG trace.
    ctx.strokeStyle = 'rgba(255,226,220,0.76)';
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(w * 0.56, h * 0.56);
    ctx.lineTo(w * 0.64, h * 0.56);
    ctx.lineTo(w * 0.68, h * 0.43);
    ctx.lineTo(w * 0.72, h * 0.7);
    ctx.lineTo(w * 0.76, h * 0.30);
    ctx.lineTo(w * 0.81, h * 0.56);
    ctx.lineTo(w * 0.96, h * 0.56);
    ctx.stroke();
    vignette(ctx, w, h);
  });

  make(scene, 'cinematic-victory', 420, 220, (ctx, w, h) => {
    roundedPanel(ctx, w, h, '#180718', '#05040a');
    const nodes = [
      [82, 110], [150, 62], [158, 153], [231, 104], [300, 56], [326, 148], [382, 103],
    ] as const;
    ctx.strokeStyle = 'rgba(255,80,181,0.34)';
    ctx.lineWidth = 3;
    for (let i = 0; i < nodes.length - 1; i++) {
      ctx.beginPath();
      ctx.moveTo(nodes[i][0], nodes[i][1]);
      ctx.lineTo(nodes[i + 1][0], nodes[i + 1][1]);
      ctx.stroke();
    }
    for (const [x, y] of nodes) {
      const glow = ctx.createRadialGradient(x, y, 2, x, y, 32);
      glow.addColorStop(0, 'rgba(255,245,252,0.94)');
      glow.addColorStop(0.16, 'rgba(255,78,184,0.74)');
      glow.addColorStop(1, 'rgba(255,48,160,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 32, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ff65c2';
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    vignette(ctx, w, h);
  });
}
