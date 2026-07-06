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

// F1/F2 nearest-feature search (3x3 neighborhood), shared by voronoi and
// caustics. Results land in module-level out-params instead of a returned
// tuple — this runs once per pixel and a per-call allocation would dominate
// the draw. `spread` scales feature jitter within its cell (keep <= 0.8 so
// features stay inside the searched neighborhood); `seed` decorrelates layers.
let _f1 = 0;
let _f2 = 0;
function voronoiF12(x: number, y: number, cell: number, spread: number, seed: number): void {
  const px = Math.floor(x / cell);
  const py = Math.floor(y / cell);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const ix = px + ox;
      const iy = py + oy;
      const fx = (ix + 0.5 + (hash2(ix + seed, iy) - 0.5) * spread) * cell;
      const fy = (iy + 0.5 + (hash2(ix + seed + 9973, iy) - 0.5) * spread) * cell;
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
  _f1 = f1;
  _f2 = f2;
}

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

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // seed 0 + spread 0.8 = this pattern's original constants (byte-stable)
      voronoiF12(x, y, cell, 0.8, 0);
      let cov: number;
      if (cellsMode) {
        cov = clamp01(0.5 + (p.weight - _f1) * cell);
      } else {
        const edgeD = _f2 - _f1;
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

// --- generative sources round 2 (clouds, sky, caustics) ---
// Same per-pixel ImageData approach as voronoi/fbm. Sources are static (no
// time param — matches the drawPattern contract); both engines composite the
// same draw into their base, so there is no CPU/GL parity surface here.

/** Billowy fbm cloud mass with cheap two-tap directional shading (Heckel
 * volumetric-cloud lighting collapsed to 2D: sample density at p and toward
 * the light, the difference is the diffuse term — no normals).
 * Param reinterpretation: cell = feature size, weight = edge softness,
 * jitter = coverage, angle = light direction, fg = cloud, bg = sky.
 * stagger is unused (reserved). */
function drawClouds(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  if (W * H > MAX_EXPORT_PIXELS) return; // bg already filled by caller
  const [fr, fg, fb] = hexRGB(p.fg);
  const [br, bg, bb] = hexRGB(p.bg);
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const baseCell = cell * 4;
  let ampSum = 0;
  for (let o = 0; o < FBM_OCTAVES; o++) ampSum += 0.5 ** o;

  // Per-octave domain rotation (golden angle) — value noise clumps along its
  // lattice axes; rotating each octave decorrelates them so masses read as
  // billows instead of rectangles.
  const rot: { c: number; s: number; cell: number; amp: number; seed: number }[] = [];
  {
    let amp = 1;
    let cellO = baseCell;
    for (let o = 0; o < FBM_OCTAVES; o++) {
      const a = o * 2.39996;
      rot.push({ c: Math.cos(a), s: Math.sin(a), cell: Math.max(2, cellO), amp, seed: o * 131071 });
      amp *= 0.5;
      cellO *= 0.5;
    }
  }

  // plain fbm mass (billow |2n-1| reads as filament webs, not cumulus);
  // pow lifts contrast so masses separate into distinct clouds
  const dens = (x: number, y: number): number => {
    let total = 0;
    for (let o = 0; o < FBM_OCTAVES; o++) {
      const r = rot[o];
      const rx = x * r.c - y * r.s;
      const ry = x * r.s + y * r.c;
      total += r.amp * valueNoise(rx / r.cell, ry / r.cell, r.seed);
    }
    return Math.pow(total / ampSum, 1.3);
  };

  const thr = 0.5 - (p.jitter - 0.25) * 0.55; // jitter = coverage bias
  const fw = Math.max(0.04, p.weight * 0.35); // weight = edge softness
  const ang = (p.angle * Math.PI) / 180;
  const lx = Math.cos(ang) * cell * 0.75;
  const ly = Math.sin(ang) * cell * 0.75;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dc = dens(x, y);
      const cov = clamp01((dc - thr) / fw);
      const i = (y * W + x) * 4;
      if (cov <= 0) {
        d[i] = br;
        d[i + 1] = bg;
        d[i + 2] = bb;
      } else {
        // two-tap directional derivative: density dropping toward the light
        // means this part of the mass faces the light (lit edge)
        const shade = (dc - dens(x + lx, y + ly)) * 3;
        const lit = cov * Math.min(1.5, Math.max(0.3, 1 + shade));
        const c = clamp01(lit);
        d[i] = br + (fr - br) * c;
        d[i + 1] = bg + (fg - bg) * c;
        d[i + 2] = bb + (fb - bb) * c;
      }
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Gradient sky with a sun disc and Henyey-Greenstein-shaped glow lobe —
 * a "golden hour generator", not a physical atmosphere.
 * Param reinterpretation: cell = sun size, weight = glow anisotropy,
 * jitter = glow intensity, angle = sun position along an arc (elevation +
 * azimuth from one dial), fg = horizon tint, bg = zenith tint.
 * stagger is unused (reserved). */
function drawSky(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  if (W * H > MAX_EXPORT_PIXELS) return;
  const [fr, fg, fb] = hexRGB(p.fg);
  const [br, bg, bb] = hexRGB(p.bg);
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const a = (p.angle * Math.PI) / 180;
  const elev = Math.abs(Math.sin(a));
  const sx = W * (0.5 + 0.42 * Math.cos(a));
  const sy = H * (0.92 - 0.78 * elev);
  const r = Math.max(3, cell);
  const diag = Math.sqrt(W * W + H * H);

  // HG phase normalized to 1 at the sun: hg/hgMax = (1-g)^3 / (1+g^2-2g*cosT)^1.5
  const g = 0.5 + p.weight * 0.45;
  const oneMinusG3 = (1 - g) ** 3;
  const glowAmp = p.jitter * 1.2;

  // sun color: horizon tint pushed most of the way to white
  const sr = fr + (255 - fr) * 0.7;
  const sg = fg + (255 - fg) * 0.7;
  const sb = fb + (255 - fb) * 0.7;

  for (let y = 0; y < H; y++) {
    // Rayleigh-ish vertical ramp: steeper tint change near the horizon
    const t = Math.pow(y / H, 0.65);
    const skyR = br + (fr - br) * t;
    const skyG = bg + (fg - bg) * t;
    const skyB = bb + (fb - bb) * t;
    for (let x = 0; x < W; x++) {
      const dx = x - sx;
      const dy = y - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dn = Math.min(1, dist / diag);
      const cosT = 1 - 2 * dn * dn;
      const hg = oneMinusG3 / Math.pow(1 + g * g - 2 * g * cosT, 1.5);
      const glow = glowAmp * hg;
      // 1px linear AA ramp on the disc edge (aaCov convention)
      const disc = clamp01(0.5 + (r - dist));
      let cr = Math.min(255, skyR + sr * glow);
      let cg = Math.min(255, skyG + sg * glow);
      let cb = Math.min(255, skyB + sb * glow);
      if (disc > 0) {
        cr += (Math.min(255, sr * 1.05) - cr) * disc;
        cg += (Math.min(255, sg * 1.05) - cg) * disc;
        cb += (Math.min(255, sb * 1.05) - cb) * disc;
      }
      const i = (y * W + x) * 4;
      d[i] = cr;
      d[i + 1] = cg;
      d[i + 2] = cb;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Water-caustic web: voronoi border distance sharpened with pow — bright
 * ridges where cells meet (fake of the refraction-convergence look).
 * Param reinterpretation: cell = cell size, weight = line width/softness,
 * jitter = feature-point spread, angle = domain rotation, stagger = adds a
 * half-scale second layer (+30°), fg = caustic lines, bg = water. */
function drawCaustics(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  if (W * H > MAX_EXPORT_PIXELS) return;
  const [fr, fg, fb] = hexRGB(p.fg);
  const [br, bg, bb] = hexRGB(p.bg);
  const img = ctx.createImageData(W, H);
  const d = img.data;

  const spread = 0.35 + p.jitter * 0.55; // stays <= 0.8 (3x3 search bound)
  const width = Math.max(0.08, p.weight * 0.8);
  const k = 1.5 + (1 - p.weight) * 3.5;
  const twoLayer = p.stagger;

  const cx = W / 2;
  const cy = H / 2;
  const ang = (p.angle * Math.PI) / 180;
  const cosA = Math.cos(-ang);
  const sinA = Math.sin(-ang);
  const warpCell = cell * 1.7;
  const warpAmp = cell * 0.7;

  // bright core + wide soft halo (edge in cell units, 0 on borders)
  const ridge = (edge: number): number =>
    Math.pow(clamp01(1 - edge / width), k) + 0.4 * Math.pow(clamp01(1 - edge / (width * 3)), 2);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx0 = x - cx;
      const dy0 = y - cy;
      // low-frequency domain warp bends the straight voronoi borders into
      // the wavering ridges real refraction makes (straight lines read as
      // cracked ceramic, not water)
      const wx = (valueNoise(x / warpCell, y / warpCell, 331) - 0.5) * warpAmp;
      const wy = (valueNoise(x / warpCell, y / warpCell, 977) - 0.5) * warpAmp;
      const rx = cx + (dx0 + wx) * cosA - (dy0 + wy) * sinA;
      const ry = cy + (dx0 + wx) * sinA + (dy0 + wy) * cosA;
      voronoiF12(rx, ry, cell, spread, 0);
      let c = ridge(_f2 - _f1);
      if (twoLayer) {
        voronoiF12(rx + 31.7, ry - 17.3, cell * 0.55, spread, 7717);
        c += 0.55 * ridge(_f2 - _f1);
      }
      c = clamp01(c);
      const i = (y * W + x) * 4;
      d[i] = br + (fr - br) * c;
      d[i + 1] = bg + (fg - bg) * c;
      d[i + 2] = bb + (fb - bb) * c;
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
    case "clouds":
      drawClouds(ctx, W, H, p, cell);
      break;
    case "sky":
      drawSky(ctx, W, H, p, cell);
      break;
    case "caustics":
      drawCaustics(ctx, W, H, p, cell);
      break;
  }
}
