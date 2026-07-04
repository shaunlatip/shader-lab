import type { PatternState } from "../../types";
import { MAX_EXPORT_PIXELS } from "../../resolution";
import { hexRGB } from "./util";

const MIN_CELL_PX = 3;
const MAX_PRIMITIVES = 4_000_000;

function hash2(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function drawDotGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const r = p.weight * cell * 0.5;
  const jit = p.jitter * cell * 0.5;
  ctx.fillStyle = p.fg;
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols * rows > MAX_PRIMITIVES) return;
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const sx = p.stagger && iy % 2 === 1 ? 0.5 : 0;
      const jx = jit > 0 ? (hash2(ix, iy) - 0.5) * 2 * jit : 0;
      const jy = jit > 0 ? (hash2(ix + 9973, iy) - 0.5) * 2 * jit : 0;
      ctx.beginPath();
      ctx.arc((ix + sx + 0.5) * cell + jx, (iy + 0.5) * cell + jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLineGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1, p.weight * cell);
  ctx.beginPath();
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if ((cols + rows) > MAX_PRIMITIVES) return;
  for (let ix = 0; ix <= cols; ix++) {
    ctx.moveTo(ix * cell, 0);
    ctx.lineTo(ix * cell, H);
  }
  for (let iy = 0; iy <= rows; iy++) {
    ctx.moveTo(0, iy * cell);
    ctx.lineTo(W, iy * cell);
  }
  ctx.stroke();
}

function drawChecker(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols * rows > MAX_PRIMITIVES) return;
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      ctx.fillStyle = (ix + iy) % 2 === 0 ? p.bg : p.fg;
      ctx.fillRect(ix * cell, iy * cell, cell, cell);
    }
  }
}

/** Rotated line screen about the canvas center — shared by stripes + moiré's two layers. */
function drawStripeLayer(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: PatternState,
  cell: number,
  angleDeg: number,
) {
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  const count = Math.ceil((diag * 2) / cell);
  if (count > MAX_PRIMITIVES) return;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1, p.weight * cell);
  ctx.beginPath();
  for (let i = -count; i <= count; i++) {
    const x = i * cell;
    ctx.moveTo(x, -diag);
    ctx.lineTo(x, diag);
  }
  ctx.stroke();
  ctx.restore();
}

function drawStripes(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  drawStripeLayer(ctx, W, H, p, cell, p.angle);
}

function drawMoire(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const delta = 2 + p.jitter * 8;
  drawStripeLayer(ctx, W, H, p, cell, p.angle);
  drawStripeLayer(ctx, W, H, p, cell, p.angle + delta);
}

function drawHex(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const r = cell / 2;
  const xStep = Math.sqrt(3) * r;
  const yStep = 1.5 * r;
  const cols = Math.ceil(W / xStep) + 2;
  const rows = Math.ceil(H / yStep) + 2;
  if (cols * rows > MAX_PRIMITIVES) return;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1, p.weight * cell * 0.5);
  for (let iy = -1; iy < rows; iy++) {
    const rowOffset = iy % 2 !== 0 ? xStep / 2 : 0;
    for (let ix = -1; ix < cols; ix++) {
      const cx = ix * xStep + rowOffset;
      const cy = iy * yStep;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = ((30 + k * 60) * Math.PI) / 180;
        const vx = cx + r * Math.cos(a);
        const vy = cy + r * Math.sin(a);
        if (k === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

function drawTruchet(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols * rows > MAX_PRIMITIVES) return;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1, p.weight * cell * 0.5);
  const r = cell / 2;
  const halfPi = Math.PI / 2;
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const x0 = ix * cell;
      const y0 = iy * cell;
      const orientA = hash2(ix, iy) < 0.5;
      ctx.beginPath();
      if (orientA) {
        // arcs centered at top-left and bottom-right corners
        ctx.arc(x0, y0, r, 0, halfPi);
        ctx.moveTo(x0 + cell - r, y0 + cell);
        ctx.arc(x0 + cell, y0 + cell, r, Math.PI, Math.PI + halfPi);
      } else {
        // arcs centered at top-right and bottom-left corners
        ctx.moveTo(x0 + cell, y0 + r);
        ctx.arc(x0 + cell, y0, r, halfPi, Math.PI);
        ctx.moveTo(x0, y0 + cell - r);
        ctx.arc(x0, y0 + cell, r, Math.PI + halfPi, Math.PI * 2);
      }
      ctx.stroke();
    }
  }
}

function drawRings(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cx = W / 2;
  const cy = H / 2;
  const maxR = Math.ceil(Math.sqrt(cx * cx + cy * cy)) + cell;
  const count = Math.ceil(maxR / cell);
  if (count > MAX_PRIMITIVES) return;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1, p.weight * cell);
  for (let i = 1; i <= count; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, i * cell, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawIso(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  // Isometric lattice: dot grid with a shear transform (oblique lattice, 60° angles)
  ctx.save();
  // shear: x' = x + 0.5*y, y' = 0.866*y  (equilateral triangle grid)
  ctx.transform(1, 0, 0.5, 0.866, 0, 0);
  const r = p.weight * cell * 0.5;
  const jit = p.jitter * cell * 0.5;
  ctx.fillStyle = p.fg;
  // extend grid to cover the sheared-out region
  const cols = Math.ceil(W / cell) + 4;
  const rows = Math.ceil(H / (cell * 0.866)) + 4;
  // bottom rows are sheared right by 0.5*y, so the left edge needs extra negative columns
  const ixStart = -Math.ceil(rows * 0.5) - 2;
  if ((cols - ixStart) * rows > MAX_PRIMITIVES) { ctx.restore(); return; }
  for (let iy = -2; iy < rows; iy++) {
    for (let ix = ixStart; ix < cols; ix++) {
      const jx = jit > 0 ? (hash2(ix, iy) - 0.5) * 2 * jit : 0;
      const jy = jit > 0 ? (hash2(ix + 9973, iy) - 0.5) * 2 * jit : 0;
      ctx.beginPath();
      ctx.arc((ix + 0.5) * cell + jx, (iy + 0.5) * cell + jy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// --- per-pixel field patterns (voronoi, fbm) ---
// Unlike the vector draws above, these are continuous fields a canvas path
// can't express — computed directly into an ImageData buffer, one sample per
// pixel, then blitted back with putImageData. Still exact/resolution-sharp at
// any export size since the math is evaluated per output pixel, not per
// primitive.

/** Cellular pattern via per-pixel nearest-feature-point search (3x3 neighborhood). */
function drawVoronoi(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  if (W * H > MAX_EXPORT_PIXELS) return; // bg already filled by caller; matches the primitive-cap doctrine
  const [fr, fg, fb] = hexRGB(p.fg);
  const [br, bg, bb] = hexRGB(p.bg);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const borderW = p.weight * 0.5;
  // p.stagger repurposed here as a style toggle ("cells" = filled F1 discs
  // instead of cell-border lines), since stagger has no meaning for a
  // continuous field.
  const cellsMode = p.stagger;

  // feature point for lattice cell (ix, iy), jittered within its own cell
  // (0.8 spread keeps it inside the 3x3 neighborhood we search below)
  const featureX = (ix: number, iy: number) => (ix + 0.5 + (hash2(ix, iy) - 0.5) * 0.8) * cell;
  const featureY = (ix: number, iy: number) => (iy + 0.5 + (hash2(ix + 9973, iy) - 0.5) * 0.8) * cell;

  for (let y = 0; y < H; y++) {
    const py = Math.floor(y / cell);
    for (let x = 0; x < W; x++) {
      const px = Math.floor(x / cell);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = px + ox;
          const iy = py + oy;
          const fx = featureX(ix, iy);
          const fy = featureY(ix, iy);
          const dx = (x - fx) / cell;
          const dy = (y - fy) / cell;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < f1) {
            f2 = f1;
            f1 = dist;
          } else if (dist < f2) {
            f2 = dist;
          }
        }
      }
      let cov: number;
      if (cellsMode) {
        cov = clamp01(0.5 + (p.weight - f1) * cell);
      } else {
        const edgeD = f2 - f1;
        cov = clamp01(0.5 + (borderW - edgeD) * cell);
      }
      const i = (y * W + x) * 4;
      d[i] = br + (fr - br) * cov;
      d[i + 1] = bg + (fg - bg) * cov;
      d[i + 2] = bb + (fb - bb) * cov;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Quintic (Perlin improved) fade — C2-continuous, avoids lattice creases raw linear mix shows. */
function quinticFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Bilinear value noise at one octave: integer lattice corners hashed (offset by
 * `seed` so octaves are independent), interpolated with the quintic fade. */
function valueNoise(u: number, v: number, seed: number): number {
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const tx = u - x0;
  const ty = v - y0;
  const h00 = hash2(x0 + seed, y0);
  const h10 = hash2(x0 + 1 + seed, y0);
  const h01 = hash2(x0 + seed, y0 + 1);
  const h11 = hash2(x0 + 1 + seed, y0 + 1);
  const fx = quinticFade(tx);
  const fy = quinticFade(ty);
  const top = h00 + (h10 - h00) * fx;
  const bot = h01 + (h11 - h01) * fx;
  return top + (bot - top) * fy;
}

const FBM_OCTAVES = 5;

/** 5-octave value-noise field, thresholded into a two-tone marbled pattern. */
function drawFbm(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  if (W * H > MAX_EXPORT_PIXELS) return; // bg already filled by caller
  const [fr, fg, fb] = hexRGB(p.fg);
  const [br, bg, bb] = hexRGB(p.bg);
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const baseCell = cell * 4; // `cell` slider reads as feature size
  // jitter repurposed as a threshold bias, weight repurposed as boundary softness
  const thr = 0.5 + (p.jitter - 0.25) * 0.6;
  const fw = Math.max(0.02, p.weight * 0.3);

  const cx = W / 2;
  const cy = H / 2;
  const ang = (p.angle * Math.PI) / 180;
  const cosA = Math.cos(-ang);
  const sinA = Math.sin(-ang);

  let ampSum = 0;
  for (let o = 0; o < FBM_OCTAVES; o++) ampSum += 0.5 ** o;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // rotate the sample domain about the canvas center before sampling
      const dx0 = x - cx;
      const dy0 = y - cy;
      const rx = cx + dx0 * cosA - dy0 * sinA;
      const ry = cy + dx0 * sinA + dy0 * cosA;

      let total = 0;
      let amp = 1;
      let cellO = baseCell;
      for (let o = 0; o < FBM_OCTAVES; o++) {
        const oc = Math.max(2, cellO);
        total += amp * valueNoise(rx / oc, ry / oc, o * 131071);
        amp *= 0.5;
        cellO *= 0.5;
      }
      total /= ampSum;

      const cov = clamp01(0.5 + (total - thr) / fw);
      const i = (y * W + x) * 4;
      d[i] = br + (fr - br) * cov;
      d[i + 1] = bg + (fg - bg) * cov;
      d[i + 2] = bb + (fb - bb) * cov;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function drawPattern(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: PatternState,
  u: number,
): void {
  const cell = Math.max(MIN_CELL_PX, p.cell * u);

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);

  switch (p.type) {
    case "dotGrid":
      drawDotGrid(ctx, W, H, p, cell);
      break;
    case "lineGrid":
      drawLineGrid(ctx, W, H, p, cell);
      break;
    case "checker":
      drawChecker(ctx, W, H, p, cell);
      break;
    case "stripes":
      drawStripes(ctx, W, H, p, cell);
      break;
    case "rings":
      drawRings(ctx, W, H, p, cell);
      break;
    case "iso":
      drawIso(ctx, W, H, p, cell);
      break;
    case "moire":
      drawMoire(ctx, W, H, p, cell);
      break;
    case "hex":
      drawHex(ctx, W, H, p, cell);
      break;
    case "truchet":
      drawTruchet(ctx, W, H, p, cell);
      break;
    case "voronoi":
      drawVoronoi(ctx, W, H, p, cell);
      break;
    case "fbm":
      drawFbm(ctx, W, H, p, cell);
      break;
  }
}
