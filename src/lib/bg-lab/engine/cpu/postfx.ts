// BG Lab — post-processing parity ops: CRT curvature, glitch, film dust, and
// character bloom. glitch + film dust are time-driven (seeded by the frame clock
// `t`) so they animate over video and animated stills. All plain CPU ops; the GL
// engine bridges them.

import type { ParamValue } from "../../types";
import { clamp, ctx2d, luma601, pb, pn, tmpCanvas } from "./util";

type Op = (canvas: HTMLCanvasElement, p: Record<string, ParamValue>, u: number, t?: number) => void;

const getData = (c: HTMLCanvasElement) => {
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { ctx, img, d: img.data, W: c.width, H: c.height };
};

// small deterministic hash RNG so animated frames are reproducible per-time
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------- CRT curvature
export const crtCurvature: Op = (canvas, p, u) => {
  const amount = pn(p, "amount", 0.25);
  if (amount <= 0) return;
  const edge = pn(p, "edge", 0.3);
  const { ctx, img, d, W, H } = getData(canvas);
  const src = new Uint8ClampedArray(d);
  const cx = W / 2,
    cy = H / 2;
  const norm = Math.max(cx, cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - cx) / norm,
        ny = (y - cy) / norm;
      const r2 = nx * nx + ny * ny;
      const k = 1 + amount * r2;
      const sx = cx + (x - cx) * k,
        sy = cy + (y - cy) * k;
      const pi = (y * W + x) * 4;
      if (sx < 0 || sx >= W || sy < 0 || sy >= H) {
        d[pi] = d[pi + 1] = d[pi + 2] = 0;
        continue;
      }
      const si = (clamp(Math.round(sy), 0, H - 1) * W + clamp(Math.round(sx), 0, W - 1)) * 4;
      // edge darkening
      const dark = 1 - clamp((r2 - (1 - edge)) / Math.max(0.001, edge), 0, 1) * edge;
      d[pi] = src[si] * dark;
      d[pi + 1] = src[si + 1] * dark;
      d[pi + 2] = src[si + 2] * dark;
    }
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- glitch
export const glitch: Op = (canvas, p, u, t = 0) => {
  const amount = pn(p, "amount", 0.4);
  if (amount <= 0) return;
  const animate = pb(p, "animate", true);
  const bands = Math.max(1, Math.round(pn(p, "bands", 18)));
  const W = canvas.width,
    H = canvas.height;
  const seed = animate ? Math.floor(t * 12) + 1 : 1;
  const rand = rng(seed);
  // snapshot, then redraw shifted horizontal bands with a channel offset
  const snap = tmpCanvas(canvas, W, H);
  ctx2d(snap).drawImage(canvas, 0, 0);
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(snap, 0, 0);
  const bandH = Math.max(1, Math.floor(H / bands));
  for (let by = 0; by < H; by += bandH) {
    if (rand() > amount) continue;
    const shift = (rand() - 0.5) * 2 * amount * W * 0.15;
    const ch = Math.min(bandH, H - by);
    ctx.drawImage(snap, 0, by, W, ch, shift, by, W, ch);
    // RGB split on the glitched band
    const split = amount * 8;
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.5;
    ctx.drawImage(snap, 0, by, W, ch, shift + split, by, W, ch);
    ctx.drawImage(snap, 0, by, W, ch, shift - split, by, W, ch);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
};

// ---------------------------------------------------------------- film dust
export const filmDust: Op = (canvas, p, u, t = 0) => {
  const amount = pn(p, "amount", 0.3);
  if (amount <= 0) return;
  const animate = pb(p, "animate", true);
  const W = canvas.width,
    H = canvas.height;
  const seed = animate ? Math.floor(t * 16) + 7 : 7;
  const rand = rng(seed);
  const ctx = ctx2d(canvas);
  ctx.save();
  // specks
  const specks = Math.floor(amount * (W * H) / 1400);
  for (let i = 0; i < specks; i++) {
    const x = rand() * W,
      y = rand() * H;
    const r = rand() * 1.6 * u + 0.4;
    const dark = rand() > 0.5;
    ctx.fillStyle = dark ? `rgba(0,0,0,${0.3 + rand() * 0.5})` : `rgba(255,255,255,${0.3 + rand() * 0.5})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // occasional vertical scratches
  const scratches = Math.floor(amount * 6);
  for (let i = 0; i < scratches; i++) {
    if (rand() > 0.6) continue;
    const x = rand() * W;
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + rand() * 0.25})`;
    ctx.lineWidth = Math.max(1, u * (0.6 + rand()));
    ctx.beginPath();
    ctx.moveTo(x, rand() * H * 0.3);
    ctx.lineTo(x + (rand() - 0.5) * 6, H - rand() * H * 0.3);
    ctx.stroke();
  }
  ctx.restore();
};

// ---------------------------------------------------------------- character bloom
// Bloom tuned for glyph ink: threshold bright strokes, blur, screen back.
export const characterBloom: Op = (canvas, p, u) => {
  const intensity = pn(p, "intensity", 0.7);
  if (intensity <= 0) return;
  const thr = pn(p, "threshold", 0.55) * 255;
  const radius = Math.max(0.5, pn(p, "radius", 6) * u);
  const W = canvas.width,
    H = canvas.height;
  const bright = tmpCanvas(canvas, W, H);
  const bctx = ctx2d(bright);
  bctx.drawImage(canvas, 0, 0);
  const bi = bctx.getImageData(0, 0, W, H),
    bd = bi.data;
  for (let i = 0; i < bd.length; i += 4) {
    const l = luma601(bd[i], bd[i + 1], bd[i + 2]);
    if (l < thr) bd[i] = bd[i + 1] = bd[i + 2] = 0;
  }
  bctx.putImageData(bi, 0, 0);
  const blurred = tmpCanvas(canvas, W, H);
  const blctx = ctx2d(blurred);
  blctx.filter = `blur(${radius}px)`;
  blctx.drawImage(bright, 0, 0);
  blctx.filter = "none";
  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalAlpha = clamp(intensity, 0, 1);
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(blurred, 0, 0);
  ctx.restore();
};
