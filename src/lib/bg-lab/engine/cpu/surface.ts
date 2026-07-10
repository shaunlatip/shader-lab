// BG Lab — surface-treatment ops: the Shopify-Editions "light & material"
// language. Ported from the teardown's §04 compositor (index.html), which is
// the screenshot-verified visual spec. All are overlay-style: they read the
// composited canvas below and blend on top, so they run as ordinary stack ops
// and auto-bridge on the GL engine (no GLSL). Pure canvas-2D / ImageData +
// Path2D + ctx.filter — worker-safe (the still-export path uses OffscreenCanvas,
// no DOM, no SVG filters), matching the constraint the `adjust` op already meets.

import type { ParamValue } from "../../types";
import { oklchToHex } from "../color/oklch";
import { clamp, ctx2d, hexRGB, lerp, mulberry32, pn, ps, tmpCanvas } from "./util";

// OKLCH → "rgba(r,g,b,a)" for gradient stops (the compositor specifies light in
// OKLCH; we bake to sRGB here and carry alpha separately).
function oklchRgba(l: number, c: number, h: number, a: number): string {
  const [r, g, b] = hexRGB(oklchToHex({ l, c, h }));
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

// Deterministic hash noise (shared by relief / stain / caustic). Seeded so
// exports repeat and tiles are stable.
function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}
function fbm(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 131);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

type Op = (canvas: HTMLCanvasElement, p: Record<string, ParamValue>, u: number, t?: number) => void;

// ---------------------------------------------------------------- lightLeak
// Three layers, never one hot radial: a broad soft-light wash, a feathered
// directional beam (screen), and a faint hue-shifted chromatic fringe on the
// beam edge. Intensity is capped by construction (alphas < 1) so it can't blow
// out — the old widget's failure mode.
export const lightLeak: Op = (canvas, p) => {
  const warm = clamp(pn(p, "warmth", 0.6), 0, 1);
  const inten = clamp(pn(p, "intensity", 0.4), 0, 1);
  if (inten <= 0) return;
  const ang = pn(p, "angle", 315);
  const W = canvas.width, H = canvas.height;
  const ctx = ctx2d(canvas);

  const lx = (0.5 + 0.42 * Math.cos((ang * Math.PI) / 180)) * W;
  const ly = (0.5 - 0.42 * Math.sin((ang * Math.PI) / 180)) * H;
  const warmHue = Math.round(92 - warm * 62);
  const coolHue = (warmHue + 150) % 360;
  const beamDir = (ang + 180) % 360;

  // wash — soft-light radial from the light origin
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  const wash = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.hypot(W, H) * 0.75);
  wash.addColorStop(0, oklchRgba(0.88, 0.02 + warm * 0.05, warmHue, inten * 0.75));
  wash.addColorStop(1, oklchRgba(0.88, 0.02 + warm * 0.05, warmHue, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // beam + fringe — screen, along the beam direction across the canvas
  const rad = (beamDir * Math.PI) / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const half = (Math.abs(dx) * W + Math.abs(dy) * H) / 2;
  const mx = W / 2, my = H / 2;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const beam = ctx.createLinearGradient(mx - dx * half, my - dy * half, mx + dx * half, my + dy * half);
  beam.addColorStop(0, oklchRgba(0.95, 0.03 + warm * 0.06, warmHue, inten * 0.38));
  beam.addColorStop(0.22, oklchRgba(0.9, 0.02 + warm * 0.04, warmHue, inten * 0.16));
  beam.addColorStop(0.55, oklchRgba(0.9, 0.02, warmHue, 0));
  ctx.fillStyle = beam;
  ctx.fillRect(0, 0, W, H);
  const fringe = ctx.createLinearGradient(mx - dx * half, my - dy * half, mx + dx * half, my + dy * half);
  fringe.addColorStop(0.08, oklchRgba(0.82, 0.05, coolHue, 0));
  fringe.addColorStop(0.26, oklchRgba(0.82, 0.05, coolHue, inten * 0.1));
  fringe.addColorStop(0.46, oklchRgba(0.82, 0.05, coolHue, 0));
  ctx.fillStyle = fringe;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Guarantee visibility on a bright/white base: soft-light and screen are
  // mathematically no-ops on a channel already at 1.0 (white can't get
  // "lighter"), so on a solid white background every layer above vanishes.
  // A low-alpha NORMAL (source-over) tint always mixes toward the light color
  // regardless of the base's own brightness — this is the layer that actually
  // shows up on white; it's subtle enough not to change the look elsewhere.
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const tint = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.hypot(W, H) * 0.75);
  tint.addColorStop(0, oklchRgba(0.92, 0.03 + warm * 0.06, warmHue, inten * 0.16));
  tint.addColorStop(1, oklchRgba(0.92, 0.03 + warm * 0.06, warmHue, 0));
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

// --- gobo silhouettes (constructed, never a blurred blob) --------------------
// Design space ≈ 1000×440 with rotation origin (500,190), matching the SVG in
// the compositor. Rendered onto a stamp canvas cover-fit to the target with
// overscan so rotation/offset never reveal an edge.
const quadPt = (a: number, b: number, c: number, t: number) => {
  const u = 1 - t;
  return u * u * a + 2 * u * t * b + t * t * c;
};
const quadTan = (a: number, b: number, c: number, t: number) => 2 * (1 - t) * (b - a) + 2 * t * (c - b);

function pathFrond(s: CanvasRenderingContext2D) {
  s.strokeStyle = "#000";
  s.fillStyle = "#000";
  s.lineCap = "round";
  s.lineWidth = 9;
  s.beginPath();
  s.moveTo(140, -70);
  s.quadraticCurveTo(430, 40, 700, 360);
  s.stroke();
  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    const x = quadPt(140, 430, 700, t), y = quadPt(-70, 40, 360, t);
    const ang = Math.atan2(quadTan(-70, 40, 360, t), quadTan(140, 430, 700, t));
    const len = 190 * (1 - 0.62 * t) + 36, w = 17 * (1 - 0.45 * t) + 5;
    const side = i % 2 ? 1 : -1, spread = ((42 + 8 * Math.sin(i * 2.1)) * Math.PI) / 180;
    s.save();
    s.translate(x, y);
    s.rotate(ang + side * spread);
    s.beginPath();
    s.moveTo(0, 0);
    s.quadraticCurveTo(len * 0.5, -w, len, 0);
    s.quadraticCurveTo(len * 0.5, w * 0.55, 0, 0);
    s.closePath();
    s.fill();
    s.restore();
  }
}
function pathBlinds(s: CanvasRenderingContext2D) {
  s.fillStyle = "#000";
  const ys = [-24, 22, 70, 116, 166, 214, 260, 310, 352];
  const hs = [19, 21, 18, 23, 20, 22, 19, 21, 20];
  ys.forEach((y, i) => s.fillRect(-140, y, 1280, hs[i]));
}
function pathWindow(s: CanvasRenderingContext2D) {
  s.fillStyle = "#000";
  ([[150, -30, 22], [520, -40, 24], [880, -30, 22]] as const).forEach(([x, dy, w]) => {
    s.beginPath();
    s.moveTo(x, -60 + dy);
    s.lineTo(x + w, -60 + dy);
    s.lineTo(x + w + 18, 440);
    s.lineTo(x + 18, 440);
    s.closePath();
    s.fill();
  });
  s.fillRect(-100, 196, 1240, 26);
}
function pathFoliage(s: CanvasRenderingContext2D) {
  s.fillStyle = "#000";
  const blobs = [
    [70, 40, 120, 74, -14], [210, -10, 150, 86, 8], [420, 30, 110, 60, -22], [105, 180, 88, 52, 18],
    [300, 140, 70, 44, -8], [840, 60, 150, 92, 12], [950, 190, 120, 66, -16], [720, -20, 96, 58, 20],
    [880, 320, 104, 60, -10], [40, 320, 90, 54, 14],
  ];
  for (const [x, y, rx, ry, r] of blobs) {
    s.beginPath();
    s.ellipse(x, y, rx, ry, (r * Math.PI) / 180, 0, Math.PI * 2);
    s.fill();
  }
}
const GOBO_SHAPES: Record<string, (s: CanvasRenderingContext2D) => void> = {
  frond: pathFrond,
  blinds: pathBlinds,
  window: pathWindow,
  foliage: pathFoliage,
};

// ---------------------------------------------------------------- gobo
// One silhouette, three stacked copies in multiply — blur/opacity/offset scale
// with occluder "distance" so the penumbra widens (never one uniform blur).
export const gobo: Op = (canvas, p, u) => {
  const strength = clamp(pn(p, "strength", 0.32), 0, 1);
  if (strength <= 0) return;
  const shape = ps(p, "shape", "frond");
  const build = GOBO_SHAPES[shape] ?? pathFrond;
  const soft = Math.max(0.5, pn(p, "softness", 7) * u);
  const gAng = (pn(p, "angle", 14) * Math.PI) / 180;
  const lightAng = pn(p, "lightAngle", 315);
  const W = canvas.width, H = canvas.height;

  // stamp: silhouette rendered once, cover-fit to the canvas with overscan.
  const stamp = tmpCanvas(canvas, W, H);
  const sctx = ctx2d(stamp);
  sctx.clearRect(0, 0, W, H);
  const scale = Math.max(W / 1000, H / 440) * 1.15;
  sctx.save();
  sctx.translate(W / 2, H / 2);
  sctx.scale(scale, scale);
  sctx.translate(-500, -190);
  build(sctx);
  sctx.restore();

  // Vogel-disk penumbra: sample the silhouette on a golden-angle spiral whose
  // radius grows and whose center drifts along the light direction — a smooth
  // distance-scaled soft shadow (Basement Studio's Daylight recipe), not three
  // discrete blur bands. Built into a temp so we composite once at `strength`.
  const lr = ((lightAng + 180) * Math.PI) / 180;
  const ox = Math.cos(lr), oy = -Math.sin(lr);
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const N = 40;
  const R = soft * 3.2; // max penumbra radius (px)
  const drift = soft * 3.2; // center travel toward the light at the disk rim

  const shadow = tmpCanvas(canvas, W, H);
  const shctx = ctx2d(shadow);
  shctx.clearRect(0, 0, W, H);
  shctx.globalAlpha = 1 / N;
  for (let i = 0; i < N; i++) {
    const rr = Math.sqrt((i + 0.5) / N); // 0..1, area-uniform
    const theta = i * GOLDEN;
    const dx = Math.cos(theta) * rr * R + ox * drift * rr;
    const dy = Math.sin(theta) * rr * R + oy * drift * rr;
    shctx.drawImage(stamp, dx, dy);
  }
  // a light blur smooths any residual tap discretization
  shctx.globalAlpha = 1;

  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = strength;
  ctx.filter = `blur(${Math.max(0.5, soft * 0.5)}px)`;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(gAng);
  ctx.translate(-W / 2, -H / 2);
  ctx.drawImage(shadow, 0, 0);
  ctx.restore();
};

// ---------------------------------------------------------------- caustic
// fbm-warped bright bands (screen). The "pool light" wash; scale sets the band
// frequency, warmth tints them.
export const caustic: Op = (canvas, p, u, t) => {
  const inten = clamp(pn(p, "intensity", 0.35), 0, 1);
  if (inten <= 0) return;
  const scale = Math.max(1, pn(p, "scale", 5));
  const warm = clamp(pn(p, "warmth", 0.3), 0, 1);
  const seed = Math.round(pn(p, "seed", 1));
  const { ctx, img, d, W, H } = getData(canvas);
  const hue = Math.round(200 - warm * 160); // teal→gold
  const [lr, lg, lb] = hexRGB(oklchToHex({ l: 0.96, c: 0.05 + warm * 0.05, h: hue }));
  const f = scale / 220;
  const phase = (t ?? 0) * 0.15;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // domain-warp the sample point, then take ridged bands
      const wx = fbm(x * f + phase, y * f, seed, 3);
      const wy = fbm(x * f + 5.2, y * f + 1.3 - phase, seed + 97, 3);
      let v = fbm(x * f + wx * 2.4, y * f + wy * 2.4, seed + 211, 3);
      v = 1 - Math.abs(v - 0.5) * 2; // ridge
      v = Math.pow(clamp(v, 0, 1), 3.2) * inten;
      const i = (y * W + x) * 4;
      // screen blend: 1-(1-a)(1-b)
      d[i] = 255 - ((255 - d[i]) * (255 - lr * v)) / 255;
      d[i + 1] = 255 - ((255 - d[i + 1]) * (255 - lg * v)) / 255;
      d[i + 2] = 255 - ((255 - d[i + 2]) * (255 - lb * v)) / 255;
    }
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- relief
// Procedural paper tooth: fbm height field → normal → Lambert with a low
// distant light, output centered near mid-gray and blended soft-light so it
// contributes relief only (the high-pass-to-50%-gray principle). CPU equivalent
// of feTurbulence(fractalNoise,5 oct) → feDiffuseLighting(azimuth/elevation).
export const relief: Op = (canvas, p) => {
  const depth = clamp(pn(p, "depth", 0.5), 0, 1);
  if (depth <= 0) return;
  const scale = Math.max(1, pn(p, "scale", 22));
  const azim = (pn(p, "lightAzimuth", 100) * Math.PI) / 180;
  const elev = (pn(p, "lightElevation", 17) * Math.PI) / 180;
  const seed = Math.round(pn(p, "seed", 7));
  const W = canvas.width, H = canvas.height;
  // light vector
  const lx = Math.cos(azim) * Math.cos(elev);
  const ly = Math.sin(azim) * Math.cos(elev);
  const lz = Math.sin(elev);
  const f = scale / 900;
  const e = 1; // height-field sample step (px)
  const kh = depth * 3.0; // normal steepness from depth

  const layer = tmpCanvas(canvas, W, H);
  const lctx = ctx2d(layer);
  const id = lctx.createImageData(W, H);
  const out = id.data;
  const height = (x: number, y: number) => fbm(x * f, y * f, seed, 5);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const hL = height(x - e, y), hR = height(x + e, y);
      const hU = height(x, y - e), hD = height(x, y + e);
      // normal from height gradient
      let nx = (hL - hR) * kh, ny = (hU - hD) * kh, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const diff = clamp(nx * lx + ny * ly + nz * lz, 0, 1);
      // center on mid-gray: 0.5 at flat, brighten/darken with the dot product
      const v = clamp(0.5 + (diff - 0.62) * 0.9, 0, 1) * 255;
      const i = (y * W + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  lctx.putImageData(id, 0, 0);
  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.35 + depth * 0.5;
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
};

// ---------------------------------------------------------------- stain / foxing
// Low-frequency blotches (multiply). Many small low-contrast marks, placed from
// a seeded low-freq field — never a few large obvious blobs. `age` scales count
// and contrast.
export const stain: Op = (canvas, p) => {
  const age = clamp(pn(p, "age", 0.4), 0, 1);
  if (age <= 0) return;
  const W = canvas.width, H = canvas.height;
  const seed = Math.round(pn(p, "seed", 3));
  const [cr, cg, cb] = hexRGB(ps(p, "color", "#86643c"));
  const rnd = mulberry32(seed);
  const n = Math.round(18 + age * 46);
  const base = Math.min(W, H);
  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H;
    const r = base * (0.01 + rnd() * 0.05);
    const a = (0.03 + rnd() * 0.07) * age;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${a.toFixed(3)})`);
    g.addColorStop(0.72, `rgba(${cr},${cg},${cb},${(a * 0.4).toFixed(3)})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
};

// local getData (ops.ts has its own; kept private here to avoid a circular dep)
function getData(c: HTMLCanvasElement) {
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { ctx, img, d: img.data, W: c.width, H: c.height };
}
