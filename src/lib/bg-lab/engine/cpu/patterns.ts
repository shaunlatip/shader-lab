import type { PatternState } from "../../types";

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

function drawStripes(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  const count = Math.ceil((diag * 2) / cell);
  if (count > MAX_PRIMITIVES) return;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((p.angle * Math.PI) / 180);
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

// Graph paper: minor line grid with a heavier major line every 5 cells —
// engineering/Leuchtturm grid. Major lines reuse fg at full weight; minor
// lines draw at reduced width and alpha.
function drawGraph(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternState, cell: number) {
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  if (cols + rows > MAX_PRIMITIVES) return;
  const minorW = Math.max(0.5, p.weight * cell * 0.5);
  const majorW = Math.max(1, p.weight * cell);
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
  const arm = p.weight * cell * 0.5;
  const jit = p.jitter * cell * 0.5;
  ctx.strokeStyle = p.fg;
  ctx.lineWidth = Math.max(1, cell * 0.03);
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
  ctx.lineWidth = Math.max(1, p.weight * cell * 0.5);
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
    case "graph":
      drawGraph(ctx, W, H, p, cell);
      break;
    case "checker":
      drawChecker(ctx, W, H, p, cell);
      break;
    case "stripes":
      drawStripes(ctx, W, H, p, cell);
      break;
    case "waves":
      drawWaves(ctx, W, H, p, cell);
      break;
    case "rings":
      drawRings(ctx, W, H, p, cell);
      break;
    case "iso":
      drawIso(ctx, W, H, p, cell);
      break;
    case "plusGrid":
      drawPlusGrid(ctx, W, H, p, cell);
      break;
    case "halftoneGradient":
      drawHalftoneGradient(ctx, W, H, p, cell);
      break;
  }
}
