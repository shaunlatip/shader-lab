// BG Lab — converter / "style" ops: glyph renderers (ASCII, block chars, hatch,
// diamond, lines, dots, mixed) plus mosaic and LEGO. The glyph styles share one
// core (renderGlyph) and differ only by their catalog defaults (glyph set, draw
// mode, colors). All are plain CPU ops — the GL engine bridges them.

import type { ParamValue } from "../../types";
import { clamp, ctx2d, hexRGB, luma601, pb, pn, ps, tmpCanvas } from "./util";

type Op = (canvas: HTMLCanvasElement, p: Record<string, ParamValue>, u: number) => void;

// Sample the source down to cols×rows average colors in one drawImage.
function sampleGrid(canvas: HTMLCanvasElement, cols: number, rows: number) {
  const small = tmpCanvas(canvas, cols, rows);
  const sctx = ctx2d(small);
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(canvas, 0, 0, cols, rows);
  return sctx.getImageData(0, 0, cols, rows).data;
}

// Canvas composite modes for the glyph layer (matches ascii-magic's set).
const BLEND_OP: Record<string, GlobalCompositeOperation> = {
  normal: "source-over",
  overlay: "overlay",
  colorDodge: "color-dodge",
  screen: "screen",
  lighter: "lighter",
};

// Character-set presets (ordered dark→light). "custom" uses the Chars field.
const CHAR_SETS: Record<string, string> = {
  standard: "@#S08Xx+=-;:,. ",
  detailed: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  minimal: "@+. ",
};

const hash2 = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Shared glyph renderer. Two modes:
 *  - ramp: pick a glyph from `glyphs` (ordered dark→light) by brightness, full cell size
 *  - shape (sizeByBrightness): draw the first glyph scaled by darkness (halftone-like)
 * The `background` controls what sits behind the glyphs: a flat `paper`, the
 * `original` (or `blurred`) source image, or `transparent` — the big quality lever,
 * since glyphs-over-photo reads far richer than glyphs-on-paper. */
export const renderGlyph: Op = (canvas, p, u) => {
  const cell = Math.max(4, pn(p, "cell", 12) * u);
  const colorMode = ps(p, "colorMode", "ink");
  const sizeBy = pb(p, "sizeByBrightness", false);
  const invert = pb(p, "invert", false);
  const contrast = pn(p, "contrast", 1);
  const ink = ps(p, "ink", "#e9e4d8");
  const paper = ps(p, "paper", "#16140f");
  // Ramp polarity. Glyphs add ink; whether dense glyphs read brighter or darker
  // than the backdrop depends on ink-vs-paper luminance. Light ink on dark paper
  // (the default) means dense glyphs are *bright*, so brightness must drive
  // density — otherwise the render comes out as a tonal negative. Detecting it
  // from the colors keeps it correct whatever ink/paper the user picks; `invert`
  // is the manual override on top.
  const [ir, ig, ib] = hexRGB(ink);
  const [pr, pg, pb_] = hexRGB(paper);
  const brightDense = luma601(ir, ig, ib) >= luma601(pr, pg, pb_);
  const background = ps(p, "background", "paper"); // paper | original | blurred | transparent
  const bgBlur = Math.max(0, pn(p, "bgBlur", 0) * u);
  const charOpacity = clamp(pn(p, "charOpacity", 1), 0, 1);
  const blend = ps(p, "blendMode", "normal");
  // character depth
  const charSet = ps(p, "charSet", "custom");
  const glyphs = (charSet !== "custom" && CHAR_SETS[charSet]) || ps(p, "glyphs", "@#S08Xx+=-;:,. ") || " ";
  const fontScale = clamp(pn(p, "fontScale", 1), 0.3, 2);
  const density = clamp(pn(p, "density", 1), 0.5, 1.8);
  const coverage = clamp(pn(p, "coverage", 1), 0, 1);
  const edgeAmt = clamp(pn(p, "edgeEmphasis", 0), 0, 1);
  const brightness = clamp(pn(p, "brightness", 0), -1, 1);
  const dotGrid = pb(p, "dotGrid", false);
  const randomize = pb(p, "randomize", false);

  const W = canvas.width,
    H = canvas.height;
  const cols = Math.max(1, Math.round((W / cell) * density));
  const rows = Math.max(1, Math.round((H / cell) * density));
  const cw = W / cols,
    ch = H / rows;

  // Snapshot the incoming pixels first: they're both the brightness source AND
  // (for original/blurred) the visible background.
  const src = tmpCanvas(canvas, W, H);
  ctx2d(src).drawImage(canvas, 0, 0);
  const grid = sampleGrid(src, cols, rows);

  // Per-cell luminance (post brightness/contrast), then a cheap edge map.
  const lumA = new Float32Array(cols * rows);
  for (let k = 0; k < cols * rows; k++) {
    let l = luma601(grid[k * 4], grid[k * 4 + 1], grid[k * 4 + 2]) / 255;
    l = clamp(Math.pow(l, contrast) + brightness, 0, 1);
    lumA[k] = l;
  }
  // Auto contrast: stretch the 2nd–98th percentile of the cell-luma histogram
  // to 0..1 so every source spans the full glyph ramp. Off (fallback) for
  // stacks saved before the param existed — their output must not change.
  if (pb(p, "autoContrast", false)) {
    const sorted = Float32Array.from(lumA).sort();
    const lo = sorted[Math.floor((sorted.length - 1) * 0.02)];
    const hi = sorted[Math.floor((sorted.length - 1) * 0.98)];
    const span = hi - lo;
    if (span > 1e-4) {
      for (let k = 0; k < lumA.length; k++) lumA[k] = clamp((lumA[k] - lo) / span, 0, 1);
    }
  }
  const edgeAt = (c: number, r: number) => {
    if (edgeAmt <= 0) return 0;
    const at = (cc: number, rr: number) => lumA[clamp(rr, 0, rows - 1) * cols + clamp(cc, 0, cols - 1)];
    const gx = Math.abs(at(c - 1, r) - at(c + 1, r));
    const gy = Math.abs(at(c, r - 1) - at(c, r + 1));
    return clamp(gx + gy, 0, 1);
  };

  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, W, H);

  // background layer
  if (background === "paper") {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
  } else if (background === "original" || background === "blurred") {
    if (background === "blurred" && bgBlur > 0) {
      ctx.filter = `blur(${bgBlur}px)`;
      ctx.drawImage(src, 0, 0);
      ctx.filter = "none";
    } else {
      ctx.drawImage(src, 0, 0);
    }
  } // transparent → leave cleared

  // glyph layer (composited over the background)
  ctx.save();
  ctx.globalAlpha = charOpacity;
  ctx.globalCompositeOperation = BLEND_OP[blend] ?? "source-over";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const chars = Array.from(glyphs);
  const N = chars.length;
  const fontPx = Math.max(1, Math.min(cw, ch) * 1.15 * fontScale);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const i = k * 4;
      // edges read denser
      const lum = clamp(lumA[k] - edgeAt(c, r) * edgeAmt, 0, 1);
      // ink amount this cell should carry (1 = densest glyph / largest stamp).
      // Polarity follows ink-vs-paper so the render matches the source tone;
      // `invert` flips it manually.
      let amt = brightDense ? lum : 1 - lum;
      if (invert) amt = 1 - amt;
      if (amt < 1 - coverage) continue; // coverage thins the lowest-ink cells
      const x = (c + 0.5) * cw,
        y = (r + 0.5) * ch;
      ctx.fillStyle = colorMode === "source" ? `rgb(${grid[i]},${grid[i + 1]},${grid[i + 2]})` : ink;

      if (sizeBy) {
        if (amt <= 0.02) continue;
        ctx.font = `${Math.max(1, fontPx * Math.sqrt(amt))}px ui-monospace, monospace`;
        ctx.fillText(chars[0], x, y);
      } else {
        // chars are ordered dark→light (idx 0 = densest); high amt → densest glyph
        const idx = randomize
          ? Math.floor(hash2(c, r) * N)
          : clamp(Math.floor((1 - amt) * (N - 1)), 0, N - 1);
        const g = chars[clamp(idx, 0, N - 1)];
        if (g === " ") continue;
        ctx.font = `${fontPx}px ui-monospace, monospace`;
        ctx.fillText(g, x, y);
      }
    }
  }
  ctx.restore();

  // faint dot-grid overlay
  if (dotGrid) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.beginPath();
        ctx.arc((c + 0.5) * cw, (r + 0.5) * ch, Math.max(0.5, Math.min(cw, ch) * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
};

// ---------------------------------------------------------------- braille
// Each cell is a 2×4 dot grid mapped to a Unicode braille glyph (U+2800..28FF).
const BRAILLE_BIT = [
  [0x01, 0x02, 0x04, 0x40], // left column dots: 1,2,3,7
  [0x08, 0x10, 0x20, 0x80], // right column dots: 4,5,6,8
];
export const braille: Op = (canvas, p, u) => {
  const dot = Math.max(1.5, pn(p, "cell", 4) * u);
  const threshold = clamp(pn(p, "threshold", 0.5), 0, 1);
  const invert = pb(p, "invert", false);
  const colorMode = ps(p, "colorMode", "ink");
  const ink = ps(p, "ink", "#e9e4d8");
  const paper = ps(p, "paper", "#16140f");
  // Match renderGlyph's polarity: a raised dot reads bright under light ink, dark
  // under dark ink (see renderGlyph). Without this, braille inverts the source.
  const [ir, ig, ib] = hexRGB(ink);
  const [pr, pg, pb_] = hexRGB(paper);
  const brightDense = luma601(ir, ig, ib) >= luma601(pr, pg, pb_);
  const background = ps(p, "background", "paper");
  const bgBlur = Math.max(0, pn(p, "bgBlur", 0) * u);
  const charOpacity = clamp(pn(p, "charOpacity", 1), 0, 1);

  const W = canvas.width,
    H = canvas.height;
  const cellW = dot * 2,
    cellH = dot * 4;
  const cols = Math.max(1, Math.round(W / cellW));
  const rows = Math.max(1, Math.round(H / cellH));
  const cw = W / cols,
    ch = H / rows;

  const src = tmpCanvas(canvas, W, H);
  ctx2d(src).drawImage(canvas, 0, 0);
  const dots = sampleGrid(src, cols * 2, rows * 4); // one sample per dot
  const colorGrid = sampleGrid(src, cols, rows);

  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, W, H);
  if (background === "paper") {
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, W, H);
  } else if (background === "original" || background === "blurred") {
    if (background === "blurred" && bgBlur > 0) {
      ctx.filter = `blur(${bgBlur}px)`;
      ctx.drawImage(src, 0, 0);
      ctx.filter = "none";
    } else ctx.drawImage(src, 0, 0);
  }

  ctx.save();
  ctx.globalAlpha = charOpacity;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${cellH}px ui-monospace, monospace`;
  const dotCols = cols * 2;
  const dotRows = rows * 4;

  // Per-dot "ink demand" (0..1) in raised-dot polarity, so tone mapping and
  // dithering share one scale regardless of ink/paper/invert. The cut point
  // maps the legacy threshold semantics into demand space per polarity:
  // brightDense on⟺lum>=threshold⟺demand>=threshold; darkDense
  // on⟺lum<threshold⟺demand>1-threshold.
  const demand = new Float32Array(dotCols * dotRows);
  for (let y = 0; y < dotRows; y++) {
    for (let x = 0; x < dotCols; x++) {
      const i = (y * dotCols + x) * 4;
      const lum = luma601(dots[i], dots[i + 1], dots[i + 2]) / 255;
      let d = brightDense ? lum : 1 - lum;
      if (invert) d = 1 - d;
      demand[y * dotCols + x] = d;
    }
  }
  const cut = brightDense !== invert ? threshold : 1 - threshold;

  // Error diffusion (Floyd–Steinberg, serpentine) across the dot lattice —
  // braille embossers dither for tone; a hard threshold posterizes. Off
  // (fallback) for stacks saved before the param existed.
  const on = new Uint8Array(dotCols * dotRows);
  if (pb(p, "dither", false)) {
    const buf = Float32Array.from(demand);
    for (let y = 0; y < dotRows; y++) {
      const ltr = y % 2 === 0;
      for (let step = 0; step < dotCols; step++) {
        const x = ltr ? step : dotCols - 1 - step;
        const k = y * dotCols + x;
        const v = buf[k];
        const o = v >= cut ? 1 : 0;
        on[k] = o;
        const err = v - (o ? 1 : 0);
        const xf = ltr ? x + 1 : x - 1;
        const xb = ltr ? x - 1 : x + 1;
        if (xf >= 0 && xf < dotCols) buf[y * dotCols + xf] += err * (7 / 16);
        if (y + 1 < dotRows) {
          if (xb >= 0 && xb < dotCols) buf[(y + 1) * dotCols + xb] += err * (3 / 16);
          buf[(y + 1) * dotCols + x] += err * (5 / 16);
          if (xf >= 0 && xf < dotCols) buf[(y + 1) * dotCols + xf] += err * (1 / 16);
        }
      }
    }
  } else {
    for (let k = 0; k < demand.length; k++) on[k] = demand[k] >= cut ? 1 : 0;
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let bits = 0;
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          if (on[(r * 4 + dy) * dotCols + (c * 2 + dx)]) bits |= BRAILLE_BIT[dx][dy];
        }
      }
      if (bits === 0) continue;
      const ci = (r * cols + c) * 4;
      ctx.fillStyle = colorMode === "source" ? `rgb(${colorGrid[ci]},${colorGrid[ci + 1]},${colorGrid[ci + 2]})` : ink;
      ctx.fillText(String.fromCharCode(0x2800 + bits), (c + 0.5) * cw, (r + 0.5) * ch);
    }
  }
  ctx.restore();
};

// ---------------------------------------------------------------- mosaic
// Like square pixelate but draws crisp tiles (optionally with a gap) and can
// sample wide/tall tile shapes.
export const mosaic: Op = (canvas, p, u) => {
  const size = Math.max(2, pn(p, "size", 16) * u);
  const gap = clamp(pn(p, "gap", 0), 0, 0.5);
  const shape = ps(p, "shape", "square");
  const W = canvas.width,
    H = canvas.height;
  const aspect = shape === "wide" ? 2 : shape === "tall" ? 0.5 : 1;
  const cw = size * aspect,
    ch = size / aspect;
  const cols = Math.max(1, Math.round(W / cw));
  const rows = Math.max(1, Math.round(H / ch));
  const grid = sampleGrid(canvas, cols, rows);
  const tw = W / cols,
    th = H / rows;
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, W, H);
  const inset = gap * Math.min(tw, th);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      ctx.fillStyle = `rgb(${grid[i]},${grid[i + 1]},${grid[i + 2]})`;
      ctx.fillRect(c * tw + inset / 2, r * th + inset / 2, tw - inset, th - inset);
    }
  }
};

// ---------------------------------------------------------------- lineArt
// Sobel-on-luma edge detector with outline, crosshatch, and combined ink modes.
// Reads from a snapshot so Sobel never reads its own writes.
export const lineArt: Op = (canvas, p, u) => {
  const mode = ps(p, "mode", "outline");
  const thickness = clamp(pn(p, "thickness", 1.5) * u, 1, 40);
  const threshold = clamp(pn(p, "threshold", 0.5), 0, 1);
  const wiggleAmt = clamp(pn(p, "wiggle", 0), 0, 1);
  const hatchSpacing = Math.max(2, pn(p, "hatchSpacing", 8) * u);
  const [inkR, inkG, inkB] = hexRGB(ps(p, "ink", "#16140f"));
  const [paperR, paperG, paperB] = hexRGB(ps(p, "paper", "#f1ece4"));

  const W = canvas.width, H = canvas.height;

  // snapshot to read from (never read back own writes)
  const snap = tmpCanvas(canvas, W, H);
  const snapCtx = ctx2d(snap);
  snapCtx.drawImage(canvas, 0, 0);
  const src = snapCtx.getImageData(0, 0, W, H).data;

  const ctx = ctx2d(canvas);
  const d = new Uint8ClampedArray(W * H * 4);

  // hash for wiggle: cheap sin-based (coords are bounded pixel space, not huge UV floats)
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };

  // luma at a source pixel (0..1), with wiggle offset applied to sample coords
  const lumaAt = (px: number, py: number): number => {
    let sx = px, sy = py;
    if (wiggleAmt > 0) {
      const h = hash(Math.floor(px / 4), Math.floor(py / 4));
      const freq = 0.08;
      sx += Math.sin(py * freq) * h * wiggleAmt * 8;
      sy += Math.cos(px * freq) * h * wiggleAmt * 8;
    }
    const xi = clamp(Math.round(sx), 0, W - 1);
    const yi = clamp(Math.round(sy), 0, H - 1);
    const i = (yi * W + xi) * 4;
    return luma601(src[i], src[i + 1], src[i + 2]) / 255;
  };

  // Sobel on luma: Sx=[[-1,0,1],[-2,0,2],[-1,0,1]], Sy = Sx^T
  const sobelMag = (x: number, y: number): number => {
    const l = (dx: number, dy: number) => lumaAt(x + dx, y + dy);
    const gx = -l(-1,-1) + l(1,-1) - 2*l(-1,0) + 2*l(1,0) - l(-1,1) + l(1,1);
    const gy = -l(-1,-1) - 2*l(0,-1) - l(1,-1) + l(-1,1) + 2*l(0,1) + l(1,1);
    return Math.sqrt(gx * gx + gy * gy);
  };

  // crosshatch luma bands (reference §D): at 3 luma thresholds draw diagonal/h/v lines
  const isHatch = (x: number, y: number, lum: number): boolean => {
    const s = hatchSpacing;
    if (lum <= 0.45 && (y % s) <= 1) return true;           // horizontal lines for darkest
    if (lum <= 0.55 && (x % s) <= 1) return true;           // vertical lines
    if (lum <= 0.65 && ((x + y) % s) <= 1) return true;     // diagonal lines
    return false;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) * 4;
      const lum = lumaAt(x, y);

      let isInk = false;

      if (mode === "outline" || mode === "ink") {
        // magnitude test: thickness scales the neighborhood check
        const mag = sobelMag(x, y);
        // also sample a small neighborhood when thickness > 1 to thicken edges
        let edgeMag = mag;
        if (thickness > 1) {
          const r = Math.ceil(thickness - 1);
          for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
              if (dx === 0 && dy === 0) continue;
              edgeMag = Math.max(edgeMag, sobelMag(x + dx, y + dy));
            }
          }
        }
        if (edgeMag > threshold) isInk = true;
      }

      if (mode === "hatch" || mode === "ink") {
        if (isHatch(x, y, lum)) isInk = true;
      }

      d[pi]     = isInk ? inkR : paperR;
      d[pi + 1] = isInk ? inkG : paperG;
      d[pi + 2] = isInk ? inkB : paperB;
      d[pi + 3] = 255;
    }
  }

  const out = ctx.createImageData(W, H);
  out.data.set(d);
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- kuwahara
// Edge-preserving painterly filter. Reads from a snapshot; never reads own writes.
// Radius hard-capped at 12 regardless of the param value (plus unit scaling) to
// prevent O(W·H·R²) blow-up on large exports — unit:true means the catalog's
// max of 12 already caps at 12 CSS units, but we enforce the pixel cap here too.
const KW_R_CAP = 12;

export const kuwahara: Op = (canvas, p, u) => {
  const R = Math.min(KW_R_CAP, Math.max(2, Math.round(pn(p, "radius", 4) * u)));
  const smooth = ps(p, "quality", "fast") === "smooth";

  const W = canvas.width, H = canvas.height;

  const snap = tmpCanvas(canvas, W, H);
  ctx2d(snap).drawImage(canvas, 0, 0);
  const src = ctx2d(snap).getImageData(0, 0, W, H).data;

  const ctx = ctx2d(canvas);
  const d = new Uint8ClampedArray(W * H * 4);

  const getR = (i: number) => src[i];
  const getG = (i: number) => src[i + 1];
  const getB = (i: number) => src[i + 2];

  if (!smooth) {
    // fast: 4 overlapping quadrant sectors
    // sector accumulates [sumR, sumG, sumB, sumR², sumG², sumB², count]
    const sectorStats = (
      x: number, y: number,
      x0: number, x1: number, y0: number, y1: number,
    ): [number, number, number, number] => {
      let sr = 0, sg = 0, sb = 0;
      let sr2 = 0, sg2 = 0, sb2 = 0;
      let n = 0;
      for (let dy = y0; dy <= y1; dy++) {
        const py = clamp(y + dy, 0, H - 1);
        for (let dx = x0; dx <= x1; dx++) {
          const px = clamp(x + dx, 0, W - 1);
          const i = (py * W + px) * 4;
          const r = getR(i), g = getG(i), b = getB(i);
          sr += r; sg += g; sb += b;
          sr2 += r * r; sg2 += g * g; sb2 += b * b;
          n++;
        }
      }
      const invN = 1 / n;
      const mr = sr * invN, mg = sg * invN, mb = sb * invN;
      const vr = sr2 * invN - mr * mr;
      const vg = sg2 * invN - mg * mg;
      const vb = sb2 * invN - mb * mb;
      const variance = 0.299 * vr + 0.587 * vg + 0.114 * vb;
      return [mr, mg, mb, variance];
    };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s0 = sectorStats(x, y, -R, 0, -R, 0);
        const s1 = sectorStats(x, y,  0, R, -R, 0);
        const s2 = sectorStats(x, y, -R, 0,  0, R);
        const s3 = sectorStats(x, y,  0, R,  0, R);
        let best = s0;
        if (s1[3] < best[3]) best = s1;
        if (s2[3] < best[3]) best = s2;
        if (s3[3] < best[3]) best = s3;
        const pi = (y * W + x) * 4;
        d[pi]     = clamp(Math.round(best[0]), 0, 255);
        d[pi + 1] = clamp(Math.round(best[1]), 0, 255);
        d[pi + 2] = clamp(Math.round(best[2]), 0, 255);
        d[pi + 3] = 255;
      }
    }
  } else {
    // smooth: 8 angular sectors over a circular neighbourhood (Papari-style).
    // Each sector spans a 45° wedge of the disc of radius R.
    // Sector k covers angles [k*45°, (k+1)*45°).
    const TWO_PI = Math.PI * 2;
    const SECTORS = 8;
    const sectorAngle = TWO_PI / SECTORS;

    // The disc test + atan2 sector index depend only on (dx,dy) — identical for
    // every pixel. Precompute the offset list once (same dy-outer/dx-inner order
    // as the original loop, so accumulation order — and float results — match).
    const offs: number[] = [];
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        let ang = Math.atan2(dy, dx);
        if (ang < 0) ang += TWO_PI;
        offs.push(dx, dy, Math.min(SECTORS - 1, Math.floor(ang / sectorAngle)));
      }
    const offN = offs.length;

    // Per-sector accumulators, hoisted out of the pixel loop (allocating these
    // per pixel was ~14M Float32Array constructions per 1080p frame).
    const sr  = new Float32Array(SECTORS);
    const sg  = new Float32Array(SECTORS);
    const sb  = new Float32Array(SECTORS);
    const sr2 = new Float32Array(SECTORS);
    const sg2 = new Float32Array(SECTORS);
    const sb2 = new Float32Array(SECTORS);
    const sn  = new Float32Array(SECTORS);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        sr.fill(0); sg.fill(0); sb.fill(0);
        sr2.fill(0); sg2.fill(0); sb2.fill(0);
        sn.fill(0);

        for (let o = 0; o < offN; o += 3) {
          const px = clamp(x + offs[o], 0, W - 1);
          const py = clamp(y + offs[o + 1], 0, H - 1);
          const k = offs[o + 2];
          const i = (py * W + px) * 4;
          const r = src[i], g = src[i + 1], b = src[i + 2];
          sr[k]  += r;  sg[k]  += g;  sb[k]  += b;
          sr2[k] += r * r; sg2[k] += g * g; sb2[k] += b * b;
          sn[k]  += 1;
        }

        let bestVar = Infinity;
        let bestR = 0, bestG = 0, bestB = 0;
        for (let k = 0; k < SECTORS; k++) {
          const n = sn[k];
          if (n < 1) continue;
          const invN = 1 / n;
          const mr = sr[k] * invN, mg = sg[k] * invN, mb = sb[k] * invN;
          const vr = sr2[k] * invN - mr * mr;
          const vg = sg2[k] * invN - mg * mg;
          const vb = sb2[k] * invN - mb * mb;
          const variance = 0.299 * vr + 0.587 * vg + 0.114 * vb;
          if (variance < bestVar) { bestVar = variance; bestR = mr; bestG = mg; bestB = mb; }
        }

        const pi = (y * W + x) * 4;
        d[pi]     = clamp(Math.round(bestR), 0, 255);
        d[pi + 1] = clamp(Math.round(bestG), 0, 255);
        d[pi + 2] = clamp(Math.round(bestB), 0, 255);
        d[pi + 3] = 255;
      }
    }
  }

  const out = ctx.createImageData(W, H);
  out.data.set(d);
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- lego
// Posterised studded tiles: a flat brick fill per cell + a raised dot with a
// light highlight and dark shade.
export const lego: Op = (canvas, p, u) => {
  const size = Math.max(6, pn(p, "size", 22) * u);
  const W = canvas.width,
    H = canvas.height;
  const cols = Math.max(1, Math.round(W / size));
  const rows = Math.max(1, Math.round(H / size));
  const grid = sampleGrid(canvas, cols, rows);
  const tw = W / cols,
    th = H / rows;
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, W, H);
  const studR = Math.min(tw, th) * 0.3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 4;
      const cr = grid[i],
        cg = grid[i + 1],
        cb = grid[i + 2];
      const x = c * tw,
        y = r * th;
      // brick base
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.fillRect(x, y, tw + 0.5, th + 0.5);
      // bevel: light top-left, dark bottom-right
      ctx.fillStyle = `rgba(255,255,255,0.16)`;
      ctx.fillRect(x, y, tw, th * 0.12);
      ctx.fillStyle = `rgba(0,0,0,0.18)`;
      ctx.fillRect(x, y + th * 0.88, tw, th * 0.12);
      // stud
      const cx = x + tw / 2,
        cy = y + th / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, studR, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${clamp(cr * 1.08, 0, 255)},${clamp(cg * 1.08, 0, 255)},${clamp(cb * 1.08, 0, 255)})`;
      ctx.fill();
      ctx.lineWidth = Math.max(1, studR * 0.18);
      ctx.strokeStyle = `rgba(0,0,0,0.22)`;
      ctx.stroke();
      // stud highlight
      ctx.beginPath();
      ctx.arc(cx - studR * 0.28, cy - studR * 0.28, studR * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,0.28)`;
      ctx.fill();
    }
  }
};
