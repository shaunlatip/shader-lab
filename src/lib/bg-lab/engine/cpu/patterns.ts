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

// Absolute stroke/mark width in px (Matte-parity "Thickness"). `cell` already
// carries the resolution scale (cell = p.cell * u), so u = cell / p.cell
// recovers it — every draw can turn the px thickness into device px without
// threading `u` through its signature. Fixed in px means marks do NOT fatten
// as spacing widens (the key mismatch vs Matte, where weight*cell did).
function thickPx(p: PatternState, cell: number, min = 0.75): number {
  return Math.max(min, p.thickness * (cell / p.cell));
}

// Fold the Opacity control into the foreground color as an alpha channel.
// rgba() strokes/fills composite the marks over the (opaque) background at
// p.opacity; any internal globalAlpha juggling (graph minor lines, cutting-mat
// marks) multiplies on top, which is the correct compounding. Returns p
// unchanged at full opacity so the common path allocates nothing.
function withOpacity(p: PatternState): PatternState {
  if (p.opacity >= 1) return p;
  const [r, g, b] = hexRGB(p.fg);
  const a = p.opacity < 0 ? 0 : p.opacity;
  return { ...p, fg: `rgba(${r},${g},${b},${a})` };
}

function drawDotGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const r = thickPx(p, cell, 0.5);
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
  ctx.lineWidth = thickPx(p, cell);
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
  ctx.lineWidth = thickPx(p, cell);
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
  ctx.lineWidth = thickPx(p, cell);
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
  ctx.lineWidth = thickPx(p, cell);
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
  ctx.lineWidth = thickPx(p, cell);
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
  const r = thickPx(p, cell, 0.5);
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

// Graph paper: minor line grid with a heavier major line every 5 cells —
// engineering/Leuchtturm grid. Major lines reuse fg at full weight; minor
// lines draw at reduced width and alpha.
function drawGraph(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols + rows > MAX_PRIMITIVES) return;
  const majorW = thickPx(p, cell);
  const minorW = Math.max(0.5, majorW * 0.6);
  for (const major of [false, true]) {
    ctx.strokeStyle = p.fg;
    ctx.globalAlpha = major ? 1 : 0.45;
    ctx.lineWidth = major ? majorW : minorW;
    ctx.beginPath();
    for (let ix = 0; ix <= cols; ix++) {
      if ((ix % 5 === 0) !== major) continue;
      ctx.moveTo(ix * cell, 0);
      ctx.lineTo(ix * cell, H);
    }
    for (let iy = 0; iy <= rows; iy++) {
      if ((iy % 5 === 0) !== major) continue;
      ctx.moveTo(0, iy * cell);
      ctx.lineTo(W, iy * cell);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Plus/cross markers at grid intersections — registration-mark texture.
function drawPlusGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols * rows > MAX_PRIMITIVES) return;
  // Arm length is a small fixed fraction of spacing (Matte-style registration
  // ticks) — thickness drives stroke width, not arm size.
  const arm = cell * 0.16;
  const jit = p.jitter * cell * 0.5;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = thickPx(p, cell);
  ctx.beginPath();
  for (let iy = 0; iy <= rows; iy++) {
    for (let ix = 0; ix <= cols; ix++) {
      const jx = jit > 0 ? (hash2(ix, iy) - 0.5) * 2 * jit : 0;
      const jy = jit > 0 ? (hash2(ix + 9973, iy) - 0.5) * 2 * jit : 0;
      const x = ix * cell + jx;
      const y = iy * cell + jy;
      ctx.moveTo(x - arm, y);
      ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm);
      ctx.lineTo(x, y + arm);
    }
  }
  ctx.stroke();
}

// X marks at grid intersections — plusGrid rotated 45°, same arm length so
// the two read as siblings at matching weight/cell.
function drawXGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols * rows > MAX_PRIMITIVES) return;
  // Same fixed arm as plusGrid so the two read as siblings at matching
  // spacing/thickness; SQRT1_2 keeps the diagonal X inside the same box.
  const arm = cell * 0.16 * Math.SQRT1_2;
  const jit = p.jitter * cell * 0.5;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = thickPx(p, cell);
  ctx.beginPath();
  for (let iy = 0; iy <= rows; iy++) {
    for (let ix = 0; ix <= cols; ix++) {
      const jx = jit > 0 ? (hash2(ix, iy) - 0.5) * 2 * jit : 0;
      const jy = jit > 0 ? (hash2(ix + 9973, iy) - 0.5) * 2 * jit : 0;
      const x = ix * cell + jx;
      const y = iy * cell + jy;
      ctx.moveTo(x - arm, y - arm);
      ctx.lineTo(x + arm, y + arm);
      ctx.moveTo(x - arm, y + arm);
      ctx.lineTo(x + arm, y - arm);
    }
  }
  ctx.stroke();
}

// Cutting mat: a camera/registration test-chart mat. ONLY the background grid
// and the edge ruler ticks scale with `cell` (spacing) — every registration
// mark (corner bullseye + crosshair, the mid-right circle cluster, the
// bottom-left sunburst, the concentric arcs, the corner diagonals, the border
// and inner frame) is FIXED: positioned as a fraction of W/H and sized in `S`
// (= W/1000 = u), so it is pixel-identical across every spacing value, exactly
// like marks silk-screened onto a physical mat. `thickness` drives stroke
// width, `opacity` fades every stroke (via the fg alpha), `angle` spins the
// whole mat about the canvas center.
function drawCuttingMat(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number, u: number) {
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((p.angle * Math.PI) / 180);
  ctx.translate(-W / 2, -H / 2);

  ctx.strokeStyle = p.fg;
  ctx.fillStyle = p.fg;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";

  const S = W / 1000; // fixed-mark size unit (N*S spans N/1000 of the width == N*u)
  const mw = Math.max(0.6, p.thickness * u * 0.85); // registration-mark stroke
  const fw = Math.max(0.4, p.thickness * u * 0.55); // fine stroke (diagonals, rays, ticks)
  const mx = 0.03 * W; // border margin
  const my = 0.032 * H;

  // The reference chart lays its grid on a ~2500px virtual sheet — `spacing` is
  // in sheet-px, so the mat always shows 2500/spacing divisions regardless of
  // render resolution (marks stay fixed fractions of W). This is NOT the lab's
  // usual cell = spacing*u; the cutting mat matches the reference's own scale.
  const GRID_BASE = 2500;
  const g = Math.max(2, (W * p.cell) / GRID_BASE);

  // --- 1. grid (SCALES with spacing) — minor every cell, major every 5 ---
  const cols = Math.ceil(W / g);
  const rows = Math.ceil(H / g);
  if (cols + rows <= MAX_PRIMITIVES) {
    const gMajor = Math.max(0.5, p.thickness * u);
    for (const major of [false, true]) {
      ctx.globalAlpha = major ? 0.5 : 0.28;
      ctx.lineWidth = major ? gMajor : Math.max(0.35, gMajor * 0.55);
      ctx.beginPath();
      for (let ix = 0; ix <= cols; ix++) {
        if ((ix % 5 === 0) !== major) continue;
        ctx.moveTo(ix * g, 0);
        ctx.lineTo(ix * g, H);
      }
      for (let iy = 0; iy <= rows; iy++) {
        if ((iy % 5 === 0) !== major) continue;
        ctx.moveTo(0, iy * g);
        ctx.lineTo(W, iy * g);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // helpers for the fixed marks
  const rings = (cx: number, cy: number, radii: number[], dotR: number) => {
    ctx.lineWidth = mw;
    for (const r of radii) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (dotR > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const crosshair = (cx: number, cy: number, len: number, lw: number) => {
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - len, cy);
    ctx.lineTo(cx + len, cy);
    ctx.moveTo(cx, cy - len);
    ctx.lineTo(cx, cy + len);
    ctx.stroke();
  };

  // --- 2. edge ruler ticks (SCALE with spacing), aligned to the grid ---
  const tMin = 9 * S;
  const tMaj = 18 * S;
  ctx.lineWidth = fw;
  ctx.beginPath();
  for (let ix = 0; ix <= cols; ix++) {
    const x = ix * g;
    if (x < mx || x > W - mx) continue;
    const L = ix % 5 === 0 ? tMaj : tMin;
    ctx.moveTo(x, my);
    ctx.lineTo(x, my + L);
    ctx.moveTo(x, H - my);
    ctx.lineTo(x, H - my - L);
  }
  for (let iy = 0; iy <= rows; iy++) {
    const y = iy * g;
    if (y < my || y > H - my) continue;
    const L = iy % 5 === 0 ? tMaj : tMin;
    ctx.moveTo(mx, y);
    ctx.lineTo(mx + L, y);
    ctx.moveTo(W - mx, y);
    ctx.lineTo(W - mx - L, y);
  }
  ctx.stroke();

  // --- 3. border frame (FIXED) ---
  ctx.lineWidth = Math.max(0.75, p.thickness * u * 1.1);
  ctx.strokeRect(mx, my, W - 2 * mx, H - 2 * my);

  // --- 4. corner-to-corner diagonals (FIXED) ---
  ctx.lineWidth = fw;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(W - mx, H - my);
  ctx.moveTo(W - mx, my);
  ctx.lineTo(mx, H - my);
  ctx.stroke();

  // --- 5. inner frame (FIXED) ---
  ctx.lineWidth = fw;
  ctx.strokeRect(0.13 * W, 0.15 * H, 0.74 * W, 0.71 * H);
  ctx.globalAlpha = 1;

  // --- 6. top-right bullseye + crosshair (FIXED) ---
  {
    const cx = 0.85 * W;
    const cy = 0.168 * H;
    rings(cx, cy, [30 * S, 58 * S, 88 * S], 6 * S);
    crosshair(cx, cy, 106 * S, mw);
  }

  // --- 7. mid-right circle cluster, 2 rows x 4 cols (FIXED) ---
  {
    const ccx = 0.775 * W;
    const ccy = 0.545 * H;
    const px = 0.052 * W;
    const py = 0.06 * H;
    const R = 27 * S;
    const rIn = 14 * S;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 4; c++) {
        const x = ccx + (c - 1.5) * px;
        const y = ccy + (r - 0.5) * py;
        ctx.lineWidth = mw;
        ctx.beginPath();
        ctx.arc(x, y, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, rIn, 0, Math.PI * 2);
        ctx.stroke();
        crosshair(x, y, R, fw);
        ctx.beginPath();
        ctx.arc(x, y, 3 * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // --- 8. bottom-left sunburst — bullseye + a fan of rays (FIXED) ---
  {
    const cx = 0.135 * W;
    const cy = 0.886 * H;
    rings(cx, cy, [22 * S, 45 * S, 68 * S], 6 * S);
    // angles CCW from +x (up = +90°); lengths as a fraction of W
    const rays: [number, number][] = [
      [180, 0.14], [125, 0.14], [100, 0.15], [86, 0.14],
      [55, 0.17], [40, 0.19], [22, 0.15], [8, 0.14],
    ];
    ctx.lineWidth = fw;
    ctx.beginPath();
    for (const [deg, lenF] of rays) {
      const a = (deg * Math.PI) / 180;
      const len = lenF * W;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * len, cy - Math.sin(a) * len);
    }
    ctx.stroke();
  }

  // --- 9. bottom concentric arcs — domes opening upward (FIXED) ---
  {
    const cx = 0.56 * W;
    const cy = 0.95 * H;
    ctx.lineWidth = fw;
    for (const rF of [0.135, 0.19, 0.245]) {
      ctx.beginPath();
      ctx.arc(cx, cy, rF * W, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.restore();
}

// Halftone gradient: screened dots whose radius follows a linear ramp along
// the angle direction — the print-shop tint ramp.
function drawHalftoneGradient(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols * rows > MAX_PRIMITIVES) return;
  const ang = (p.angle * Math.PI) / 180;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  // project canvas corners onto the ramp axis to normalize 0..1
  let min = Infinity;
  let max = -Infinity;
  for (const [cx, cy] of [[0, 0], [W, 0], [0, H], [W, H]] as const) {
    const t = cx * dx + cy * dy;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  const span = Math.max(1e-6, max - min);
  ctx.fillStyle = p.fg;
  for (let iy = 0; iy < rows; iy++) {
    const sx = p.stagger && iy % 2 === 1 ? 0.5 : 0;
    for (let ix = 0; ix < cols; ix++) {
      const x = (ix + sx + 0.5) * cell;
      const y = (iy + 0.5) * cell;
      const t = (x * dx + y * dy - min) / span;
      // area-linear ramp (sqrt) like a real halftone tint
      const r = Math.sqrt(t) * p.weight * cell * 0.9;
      if (r < 0.3) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Sine-wave lines — topographic texture; angle rotates the whole field.
function drawWaves(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  const count = Math.ceil((diag * 2) / cell);
  if (count > MAX_PRIMITIVES) return;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((p.angle * Math.PI) / 180);
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = thickPx(p, cell);
  const amp = cell * 0.35;
  const wl = cell * 4;
  const step = Math.max(2, cell / 8);
  for (let i = -count; i <= count; i++) {
    const y = i * cell;
    ctx.beginPath();
    for (let x = -diag; x <= diag; x += step) {
      const yy = y + Math.sin((x / wl) * Math.PI * 2) * amp;
      if (x === -diag) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
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

// Tiling grids that read the same at any phase — `angle` spins the whole field
// about the canvas center. They fill 0..W/0..H, so a raw rotation would leave
// bare triangles at the corners; drawRotatedTiling over-scans to a diag×diag
// square centered on the canvas so coverage stays complete at any angle.
// Excluded: patterns that already consume `angle` themselves (stripes/waves/
// moiré self-rotate, halftone ramps along it, the generative fields rotate
// their sample domain, cutting mat spins its own marks) and rings (radially
// symmetric — rotation is a no-op, so it gets no dial).
const ROTATABLE_TILING: Partial<Record<PatternState["type"], (c: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) => void>> = {
  dotGrid: drawDotGrid,
  lineGrid: drawLineGrid,
  graph: drawGraph,
  checker: drawChecker,
  plusGrid: drawPlusGrid,
  xGrid: drawXGrid,
  hex: drawHex,
  truchet: drawTruchet,
  iso: drawIso,
};

function drawRotatedTiling(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  p: PatternState,
  cell: number,
  draw: (c: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) => void,
): void {
  if (!p.angle) {
    draw(ctx, W, H, p, cell);
    return;
  }
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((p.angle * Math.PI) / 180);
  ctx.translate(-diag / 2, -diag / 2);
  draw(ctx, diag, diag, p, cell);
  ctx.restore();
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

  // Stroke/fill patterns fade via the fg alpha (Opacity control). Generative
  // full-field draws (voronoi/fbm/clouds/sky/caustics) write opaque ImageData
  // and don't read fg the same way, so they use the raw pattern and gate the
  // Opacity control out of the panel.
  const pv = withOpacity(p);

  const tiling = ROTATABLE_TILING[p.type];
  if (tiling) {
    drawRotatedTiling(ctx, W, H, pv, cell, tiling);
    return;
  }

  switch (p.type) {
    case "stripes":
      drawStripes(ctx, W, H, pv, cell);
      break;
    case "waves":
      drawWaves(ctx, W, H, pv, cell);
      break;
    case "rings":
      drawRings(ctx, W, H, pv, cell);
      break;
    case "cuttingMat":
      drawCuttingMat(ctx, W, H, pv, cell, u);
      break;
    case "halftoneGradient":
      drawHalftoneGradient(ctx, W, H, pv, cell);
      break;
    case "moire":
      drawMoire(ctx, W, H, pv, cell);
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
