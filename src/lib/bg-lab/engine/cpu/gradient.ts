// BG Lab — gradient source draw. Fills the base canvas with a linear/radial/
// conic gradient whose stops are interpolated in OKLCH (bakeRampOklch). Called
// from BOTH engines' base composite (cpuEngine + glEngine draw the base on a 2D
// canvas), so this single CPU function is the whole gradient source — no GLSL.

import type { GradientState } from "../../types";
import { bakeRampOklch, hexToOklab, oklabToHex } from "../color/oklch";
import { DEFAULT_MESH } from "../../gradientCatalog";

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

// 4-corner mesh: bilinear blend of [TL,TR,BR,BL] in OKLab. Rendered at low res
// (the field is smooth) and upscaled with smoothing — identical look, cheap even
// at 40MP export.
function drawMesh(ctx: CanvasRenderingContext2D, W: number, H: number, colors: string[]) {
  const [tl, tr, br, bl] = [0, 1, 2, 3].map((i) => hexToOklab(colors[i] ?? DEFAULT_MESH[i]));
  const rw = Math.max(2, Math.min(W, 200));
  const rh = Math.max(2, Math.min(H, 200));
  const off = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(rw, rh) : null;
  const small = off ?? Object.assign(document.createElement("canvas"), { width: rw, height: rh });
  const sctx = (small as HTMLCanvasElement).getContext("2d")!;
  const id = sctx.createImageData(rw, rh);
  const d = id.data;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  for (let y = 0; y < rh; y++) {
    const v = rh === 1 ? 0 : y / (rh - 1);
    for (let x = 0; x < rw; x++) {
      const u = rw === 1 ? 0 : x / (rw - 1);
      // bilinear in OKLab: top edge TL→TR, bottom edge BL→BR, then vertical
      const L = mix(mix(tl.L, tr.L, u), mix(bl.L, br.L, u), v);
      const A = mix(mix(tl.a, tr.a, u), mix(bl.a, br.a, u), v);
      const B = mix(mix(tl.b, tr.b, u), mix(bl.b, br.b, u), v);
      const hex = oklabToHex(L, A, B);
      const r = parseInt(hex.slice(1, 3), 16);
      const gg = parseInt(hex.slice(3, 5), 16);
      const b2 = parseInt(hex.slice(5, 7), 16);
      const i = (y * rw + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b2; d[i + 3] = 255;
    }
  }
  sctx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small as unknown as CanvasImageSource, 0, 0, rw, rh, 0, 0, W, H);
}

// --- domain-warp (dreamy) field, colored through the OKLCH ramp -------------
// Quilez nested fbm: fbm(p + fbm(p + fbm(p))), the intermediate warp vectors
// build the impressionist wash. Optionally periodic (wraps the lattice at the
// tile period) so the export is seamless. Rendered low-res + upscaled: the
// field is smooth, so this is cheap even at 40MP.
function phash(ix: number, iy: number, period: number, seed: number): number {
  // wrap the lattice for seamless tiling when period > 0
  const wx = period > 0 ? ((ix % period) + period) % period : ix;
  const wy = period > 0 ? ((iy % period) + period) % period : iy;
  let h = (Math.imul(wx + seed, 374761393) + Math.imul(wy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const qfade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function pnoise(u: number, v: number, period: number, seed: number): number {
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const tx = qfade(u - x0), ty = qfade(v - y0);
  const a = phash(x0, y0, period, seed), b = phash(x0 + 1, y0, period, seed);
  const c = phash(x0, y0 + 1, period, seed), d = phash(x0 + 1, y0 + 1, period, seed);
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}
function pfbm(u: number, v: number, period: number, seed: number): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < 5; o++) {
    sum += amp * pnoise(u * f, v * f, period * f, seed + o * 131);
    norm += amp; amp *= 0.5; f *= 2;
  }
  return sum / norm;
}

function drawWarp(ctx: CanvasRenderingContext2D, W: number, H: number, g: GradientState) {
  const scale = Math.max(1, g.scale ?? 3);
  const warp = Math.max(0, g.warp ?? 0.55);
  const seed = Math.round(g.seed ?? 1);
  const seamless = !!g.seamless;
  const ang = ((g.angle ?? 0) * Math.PI) / 180;
  const flowX = Math.cos(ang) * warp, flowY = Math.sin(ang) * warp;
  const period = seamless ? Math.round(scale) : 0;

  // 256-entry ramp LUT (OKLCH-interpolated), indexed by the field value.
  const baked = bakeRampOklch(g.stops, 256);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const hex = baked[Math.min(255, Math.round((baked.length - 1) * (i / 255)))].color;
    lut[i * 3] = parseInt(hex.slice(1, 3), 16);
    lut[i * 3 + 1] = parseInt(hex.slice(3, 5), 16);
    lut[i * 3 + 2] = parseInt(hex.slice(5, 7), 16);
  }

  const rw = Math.max(2, Math.min(W, 640));
  const rh = Math.max(2, Math.round((rw * H) / W));
  const off = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(rw, rh) : null;
  const small = off ?? Object.assign(document.createElement("canvas"), { width: rw, height: rh });
  const sctx = (small as HTMLCanvasElement).getContext("2d")!;
  const id = sctx.createImageData(rw, rh);
  const d = id.data;
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const u = (x / rw) * scale, v = (y / rh) * scale;
      // Quilez nested warp with the canonical offset sample points
      const q1 = pfbm(u, v, period, seed);
      const q2 = pfbm(u + 5.2 + flowX, v + 1.3 + flowY, period, seed + 71);
      const r1 = pfbm(u + 4 * q1 + 1.7, v + 4 * q2 + 9.2, period, seed + 143);
      const r2 = pfbm(u + 4 * q1 + 8.3, v + 4 * q2 + 2.8, period, seed + 211);
      let f = pfbm(u + 4 * r1, v + 4 * r2, period, seed + 311);
      f = clamp01(f * 1.15 + 0.5 * (r1 - 0.5)); // lift contrast + mix a warp vector
      const idx = Math.min(255, Math.max(0, (f * 255) | 0)) * 3;
      const i = (y * rw + x) * 4;
      d[i] = lut[idx]; d[i + 1] = lut[idx + 1]; d[i + 2] = lut[idx + 2]; d[i + 3] = 255;
    }
  }
  sctx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small as unknown as CanvasImageSource, 0, 0, rw, rh, 0, 0, W, H);
}

// --- reaction-diffusion (Gray-Scott) — the feedback/accumulation source -----
// A persistent two-field simulation run to convergence at low res, colored
// through the ramp. This is the CPU delivery of the "feedback buffer" class
// (trails/reaction-diffusion) without a GL float-FBO rewrite; the field IS the
// accumulation. Deterministic (seeded), so it caches + exports stably.
function drawReaction(ctx: CanvasRenderingContext2D, W: number, H: number, g: GradientState) {
  const feed = g.feed ?? 0.037;
  const kill = g.kill ?? 0.06;
  const seed = Math.round(g.seed ?? 1);
  const GW = 160, GH = Math.max(2, Math.round((160 * H) / W));
  const n = GW * GH;
  let A = new Float32Array(n).fill(1);
  let B = new Float32Array(n).fill(0);
  let A2 = new Float32Array(n);
  let B2 = new Float32Array(n);
  // seed a few B blobs deterministically
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  for (let k = 0; k < 12; k++) {
    const cx = 4 + Math.floor(rnd() * (GW - 8));
    const cy = 4 + Math.floor(rnd() * (GH - 8));
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const ix = cx + x, iy = cy + y;
      if (ix >= 0 && ix < GW && iy >= 0 && iy < GH) B[iy * GW + ix] = 1;
    }
  }
  const idx = (x: number, y: number) => ((y + GH) % GH) * GW + ((x + GW) % GW);
  // Normalized 3×3 Laplacian (center -1, orthogonal 0.2, diagonal 0.05 → sum 0),
  // the standard Gray-Scott kernel. With dA=1, dB=0.5, dt=1 this is stable.
  const STEPS = 2400;
  for (let step = 0; step < STEPS; step++) {
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        const i = y * GW + x;
        const orthA = A[idx(x - 1, y)] + A[idx(x + 1, y)] + A[idx(x, y - 1)] + A[idx(x, y + 1)];
        const diagA = A[idx(x - 1, y - 1)] + A[idx(x + 1, y - 1)] + A[idx(x - 1, y + 1)] + A[idx(x + 1, y + 1)];
        const orthB = B[idx(x - 1, y)] + B[idx(x + 1, y)] + B[idx(x, y - 1)] + B[idx(x, y + 1)];
        const diagB = B[idx(x - 1, y - 1)] + B[idx(x + 1, y - 1)] + B[idx(x - 1, y + 1)] + B[idx(x + 1, y + 1)];
        const a = A[i], b = B[i];
        const lapA = 0.2 * orthA + 0.05 * diagA - a;
        const lapB = 0.2 * orthB + 0.05 * diagB - b;
        const abb = a * b * b;
        A2[i] = a + (1.0 * lapA - abb + feed * (1 - a));
        B2[i] = b + (0.5 * lapB + abb - (kill + feed) * b);
      }
    }
    [A, A2] = [A2, A];
    [B, B2] = [B2, B];
  }

  const baked = bakeRampOklch(g.stops, 256);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const hex = baked[i].color;
    lut[i * 3] = parseInt(hex.slice(1, 3), 16);
    lut[i * 3 + 1] = parseInt(hex.slice(3, 5), 16);
    lut[i * 3 + 2] = parseInt(hex.slice(5, 7), 16);
  }
  const off = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(GW, GH) : null;
  const small = off ?? Object.assign(document.createElement("canvas"), { width: GW, height: GH });
  const sctx = (small as HTMLCanvasElement).getContext("2d")!;
  const id = sctx.createImageData(GW, GH);
  const d = id.data;
  for (let i = 0; i < n; i++) {
    const v = clamp01(A[i] - B[i]);
    const c = Math.min(255, (v * 255) | 0) * 3;
    d[i * 4] = lut[c]; d[i * 4 + 1] = lut[c + 1]; d[i * 4 + 2] = lut[c + 2]; d[i * 4 + 3] = 255;
  }
  sctx.putImageData(id, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small as unknown as CanvasImageSource, 0, 0, GW, GH, 0, 0, W, H);
}

export function drawGradient(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  g: GradientState,
) {
  if (g.type === "mesh") {
    drawMesh(ctx, W, H, g.mesh ?? DEFAULT_MESH);
    return;
  }
  if (g.type === "warp") {
    drawWarp(ctx, W, H, g);
    return;
  }
  if (g.type === "reaction") {
    drawReaction(ctx, W, H, g);
    return;
  }
  const baked = bakeRampOklch(g.stops, 48);
  const cx = clamp01(g.cx) * W;
  const cy = clamp01(g.cy) * H;

  let grad: CanvasGradient;
  if (g.type === "linear") {
    // angle 0° = left→right; the ramp axis passes through the canvas center and
    // is extended far enough that the 0..1 stops span the full canvas along it.
    const rad = (g.angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const half = (Math.abs(dx) * W + Math.abs(dy) * H) / 2;
    const mx = W / 2;
    const my = H / 2;
    grad = ctx.createLinearGradient(mx - dx * half, my - dy * half, mx + dx * half, my + dy * half);
  } else if (g.type === "conic") {
    // createConicGradient exists on 2D + OffscreenCanvas contexts in modern
    // Chromium (the engine's target); angle is the sweep start.
    grad = ctx.createConicGradient((g.angle * Math.PI) / 180, cx, cy);
  } else {
    // radius = fraction of the half-diagonal; 1.0 reaches the farthest corner
    // from a centered origin, up to 1.5 overshoots for a softer falloff.
    const r = Math.max(1, g.radius * Math.hypot(W, H) * 0.5);
    grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  }

  for (const s of baked) grad.addColorStop(clamp01(s.t), s.color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}
