// BG Lab — CPU 2D-canvas effect ops. Each op mutates the canvas in place:
//   op(canvas, params, unit)  where unit = W/1000 (size-param scaling).
// Ported from public/explorations/asset-bg/index.html and extended.

import type { EffectType, ParamValue } from "../../types";
import {
  clamp,
  ctx2d,
  ditherBnOffset,
  hexRGB,
  lerp,
  luma,
  luma601,
  linToSrgb,
  mulberry32,
  orderedThreshold,
  pb,
  pixelateBlock,
  pn,
  ps,
  pstops,
  recompose,
  srgbToLin,
  tmpCanvas,
} from "./util";

import { renderGlyph, braille, mosaic, lego, lineArt, kuwahara } from "./converters";
import { crtCurvature, glitch, filmDust, characterBloom } from "./postfx";
import { lightLeak, gobo, caustic, relief, stain } from "./surface";
import { BLUE_NOISE_128 } from "../bluenoise";

type Op = (canvas: HTMLCanvasElement, p: Record<string, ParamValue>, u: number, t?: number) => void;

const getData = (c: HTMLCanvasElement) => {
  const ctx = ctx2d(c);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { ctx, img, d: img.data, W: c.width, H: c.height };
};

// ---------------------------------------------------------------- adjust
const adjust: Op = (canvas, p) => {
  const b = pn(p, "brightness", 1),
    c = pn(p, "contrast", 1),
    s = pn(p, "saturation", 1),
    hue = pn(p, "hue", 0),
    exposure = pn(p, "exposure", 0),
    temp = pn(p, "temperature", 0),
    gamma = pn(p, "gamma", 1);
  if (b !== 1 || c !== 1 || s !== 1 || hue !== 0) {
    recompose(canvas, (ctx, snap) => {
      ctx.filter = `brightness(${b}) contrast(${c}) saturate(${s}) hue-rotate(${hue}deg)`;
      ctx.drawImage(snap, 0, 0);
      ctx.filter = "none";
    });
  }
  if (exposure !== 0 || temp !== 0 || gamma !== 1) {
    const { ctx, img, d } = getData(canvas);
    const expMul = Math.pow(2, exposure);
    const tShift = temp * 40;
    const invG = 1 / gamma;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        let v = d[i + k] * expMul + (k === 0 ? tShift : k === 2 ? -tShift : 0);
        v = clamp(v, 0, 255) / 255;
        d[i + k] = Math.pow(v, invG) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }
};

// ---------------------------------------------------------------- blur

/** Snap alpha to opaque after a blur-family recompose. The overscan/copy
 * geometry can't cover the full kernel reach at edges (gaussian: overscan r <
 * ~3σ; directional: shifted copies miss the leading/trailing r px), leaving
 * partial edge alpha in still exports. Canvas stores UNpremultiplied rgb, so
 * the blurred rgb already equals premult/alpha — the same renormalized color
 * the GL pass produces — and forcing a=255 matches GL exactly with zero rgb
 * change. Keeping the overscan geometry untouched is load-bearing: the GL
 * blur mirrors it for rgb parity (commit d5687fb). */
function opaquify(canvas: HTMLCanvasElement) {
  const ctx = ctx2d(canvas);
  const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = id.data;
  let dirty = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] !== 255) {
      d[i] = 255;
      dirty = true;
    }
  }
  if (dirty) ctx.putImageData(id, 0, 0);
}

const blur: Op = (canvas, p, u) => {
  const r = pn(p, "radius", 0) * u;
  if (r <= 0) return;
  const mode = ps(p, "mode", "gaussian");
  const W = canvas.width,
    H = canvas.height;

  if (mode === "directional") {
    const ang = (pn(p, "angle", 0) * Math.PI) / 180;
    const dx = Math.cos(ang) * r,
      dy = Math.sin(ang) * r;
    const steps = 14;
    recompose(canvas, (ctx, snap) => {
      // incremental average: alpha 1/(i+1) so the result is a true opaque mean,
      // not a stack of translucent copies that compounds to ~63% opacity.
      for (let i = 0; i < steps; i++) {
        const t = (i / (steps - 1) - 0.5) * 2;
        ctx.globalAlpha = 1 / (i + 1);
        ctx.drawImage(snap, dx * t, dy * t);
      }
      ctx.globalAlpha = 1;
    });
    opaquify(canvas);
    return;
  }

  if (mode === "radial") {
    const k = r / Math.max(W, H);
    const steps = 14;
    recompose(canvas, (ctx, snap) => {
      for (let i = 0; i < steps; i++) {
        const s = 1 + k * (i / (steps - 1));
        const dw = W * s,
          dh = H * s;
        ctx.globalAlpha = 1 / (i + 1);
        ctx.drawImage(snap, (W - dw) / 2, (H - dh) / 2, dw, dh);
      }
      ctx.globalAlpha = 1;
    });
    opaquify(canvas);
    return;
  }

  if (mode === "tiltShift") {
    const center = pn(p, "center", 0.5);
    const band = pn(p, "band", 0.3);
    recompose(canvas, (ctx, snap) => {
      ctx.filter = `blur(${r}px)`;
      ctx.drawImage(snap, -r, -r, W + 2 * r, H + 2 * r);
      ctx.filter = "none";
      // sharp focus band, feathered
      const sharp = tmpCanvas(canvas, W, H);
      const sctx = ctx2d(sharp);
      sctx.drawImage(snap, 0, 0);
      sctx.globalCompositeOperation = "destination-in";
      const cy = center * H,
        half = (band * H) / 2,
        feather = half * 0.7;
      const g = sctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(clamp((cy - half - feather) / H, 0, 1), "rgba(0,0,0,0)");
      g.addColorStop(clamp((cy - half) / H, 0, 1), "rgba(0,0,0,1)");
      g.addColorStop(clamp((cy + half) / H, 0, 1), "rgba(0,0,0,1)");
      g.addColorStop(clamp((cy + half + feather) / H, 0, 1), "rgba(0,0,0,0)");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, W, H);
      ctx.drawImage(sharp, 0, 0);
    });
    opaquify(canvas);
    return;
  }

  // gaussian (default)
  recompose(canvas, (ctx, snap) => {
    ctx.filter = `blur(${r}px)`;
    // overscan so the blur doesn't darken edges against transparency
    ctx.drawImage(snap, -r, -r, W + 2 * r, H + 2 * r);
    ctx.filter = "none";
  });
  opaquify(canvas);
};

// ---------------------------------------------------------------- pixelate
const pixelate: Op = (canvas, p, u, t) => {
  const block = pixelateBlock(p, u, t);
  const shape = ps(p, "shape", "square");
  const W = canvas.width,
    H = canvas.height;
  const sw = Math.max(1, Math.round(W / block)),
    sh = Math.max(1, Math.round(H / block));
  const small = tmpCanvas(canvas, sw, sh);
  const sctx = ctx2d(small);
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(canvas, 0, 0, sw, sh);
  const ctx = ctx2d(canvas);
  if (shape === "square") {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(small, 0, 0, sw, sh, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    return;
  }
  // stamp shapes (circle/diamond) per cell using the averaged colors
  const sd = sctx.getImageData(0, 0, sw, sh).data;
  ctx.clearRect(0, 0, W, H);
  const cw = W / sw,
    ch = H / sh,
    rad = Math.min(cw, ch) / 2;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      ctx.fillStyle = `rgb(${sd[i]},${sd[i + 1]},${sd[i + 2]})`;
      const cx = (x + 0.5) * cw,
        cy = (y + 0.5) * ch;
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // diamond
        ctx.beginPath();
        ctx.moveTo(cx, cy - rad);
        ctx.lineTo(cx + rad, cy);
        ctx.lineTo(cx, cy + rad);
        ctx.lineTo(cx - rad, cy);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
};

// ---------------------------------------------------------------- posterize
const posterize: Op = (canvas, p) => {
  const L = Math.max(2, Math.round(pn(p, "levels", 5)));
  const perCh = pb(p, "perChannel", true);
  const { ctx, img, d } = getData(canvas);
  const q = (v: number) => Math.round((v / 255) * (L - 1)) / (L - 1) * 255;
  for (let i = 0; i < d.length; i += 4) {
    if (perCh) {
      d[i] = q(d[i]);
      d[i + 1] = q(d[i + 1]);
      d[i + 2] = q(d[i + 2]);
    } else {
      const l = luma601(d[i], d[i + 1], d[i + 2]);
      const k = l > 0 ? q(l) / l : 0;
      d[i] = clamp(d[i] * k, 0, 255);
      d[i + 1] = clamp(d[i + 1] * k, 0, 255);
      d[i + 2] = clamp(d[i + 2] * k, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- dither
const dither: Op = (canvas, p, u, t) => {
  const type = ps(p, "type", "bayer4");
  const bnOff = ditherBnOffset(p, t);
  const L = Math.max(2, Math.round(pn(p, "levels", 3)));
  const scale = Math.max(1, Math.round(pn(p, "scale", 2) * u));
  const mono = pb(p, "mono", false);
  const serp = pb(p, "serpentine", true);
  const pixSnap = Math.max(0, Math.round(pn(p, "pixelate", 0) * u));
  const { ctx, img, d, W, H } = getData(canvas);

  // Helper: snap (x,y) to cell origin when pixSnap>0, returns pixel index into d.
  // Used for ordered modes to read one color per retro block.
  const snapIdx = (x: number, y: number): number => {
    if (pixSnap <= 0) return (y * W + x) * 4;
    const sx = Math.min(Math.floor(x / pixSnap) * pixSnap, W - 1);
    const sy = Math.min(Math.floor(y / pixSnap) * pixSnap, H - 1);
    return (sy * W + sx) * 4;
  };

  const isDiffusion = type === "floydSteinberg" || type === "atkinson" || type === "sierra";

  // Quantized output takes only L distinct linear levels i/(L-1) — precompute
  // their sRGB bytes once instead of calling linToSrgb (Math.pow) per pixel.
  const outLevels = new Uint8ClampedArray(L);
  for (let i = 0; i < L; i++) outLevels[i] = linToSrgb(i / (L - 1));

  if (isDiffusion) {
    // --- error-diffusion family — all work in linear light ---
    const ch = mono ? 1 : 3;
    // Build float buffer in linear light (sRGB→linear).
    const buf = new Float32Array(W * H * ch);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // pixSnap: sample the snapped cell color (retro blocks)
        const pi = snapIdx(x, y);
        if (mono) {
          buf[y * W + x] = 0.299 * srgbToLin(d[pi]) + 0.587 * srgbToLin(d[pi + 1]) + 0.114 * srgbToLin(d[pi + 2]);
        } else {
          for (let k = 0; k < 3; k++) buf[(y * W + x) * 3 + k] = srgbToLin(d[pi + k]);
        }
      }
    // Quantize to L levels in linear light. round(v*(L-1))/(L-1) maps 0→0 and 1→1
    // exactly (the prior +0.5 form turned black into mid-gray at L=2).
    const qLin = (v: number) => clamp(Math.round(v * (L - 1)) / (L - 1), 0, 1);
    const idx = (x: number, y: number, k: number) => (y * W + x) * ch + k;
    const spread = (x: number, y: number, k: number, err: number, w: number) => {
      if (x < 0 || x >= W || y < 0 || y >= H) return;
      buf[idx(x, y, k)] += err * w;
    };
    for (let y = 0; y < H; y++) {
      const ltr = !serp || y % 2 === 0;
      for (let n = 0; n < W; n++) {
        const x = ltr ? n : W - 1 - n;
        const dir = ltr ? 1 : -1;
        for (let k = 0; k < ch; k++) {
          const old = buf[idx(x, y, k)];
          const nv = qLin(old);
          const err = old - nv;
          buf[idx(x, y, k)] = nv;
          if (type === "floydSteinberg") {
            spread(x + dir, y,     k, err, 7 / 16);
            spread(x - dir, y + 1, k, err, 3 / 16);
            spread(x,       y + 1, k, err, 5 / 16);
            spread(x + dir, y + 1, k, err, 1 / 16);
          } else if (type === "atkinson") {
            // Atkinson: distributes only 6/8 of the error (retains some)
            spread(x + dir,     y,     k, err, 1 / 8);
            spread(x + dir * 2, y,     k, err, 1 / 8);
            spread(x - dir,     y + 1, k, err, 1 / 8);
            spread(x,           y + 1, k, err, 1 / 8);
            spread(x + dir,     y + 1, k, err, 1 / 8);
            spread(x,           y + 2, k, err, 1 / 8);
          } else {
            // Sierra-lite (2-row): bulk to the next pixel, rest split below
            spread(x + dir, y,     k, err, 2 / 4);
            spread(x - dir, y + 1, k, err, 1 / 4);
            spread(x,       y + 1, k, err, 1 / 4);
          }
        }
      }
    }
    // Write back: linear→sRGB. After the full diffusion pass every buf value is
    // exactly a quantized level i/(L-1), so index the precomputed table.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const pi = (y * W + x) * 4;
        if (mono) {
          const v = outLevels[Math.round(buf[y * W + x] * (L - 1))];
          d[pi] = d[pi + 1] = d[pi + 2] = v;
        } else {
          for (let k = 0; k < 3; k++) d[pi + k] = outLevels[Math.round(buf[(y * W + x) * 3 + k] * (L - 1))];
        }
      }
  } else {
    // --- ordered modes (bayer / blueNoise / stripes / crossStripe) — gamma-correct ---
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const pi = (y * W + x) * 4;
        const si = snapIdx(x, y); // snapped source index (pixSnap>0 = retro block)
        const m = orderedThreshold(type, Math.floor(x / scale), Math.floor(y / scale), bnOff) - 0.5;
        if (mono) {
          // quantize in linear light
          const vLin = 0.299 * srgbToLin(d[si]) + 0.587 * srgbToLin(d[si + 1]) + 0.114 * srgbToLin(d[si + 2]);
          const qi = clamp(Math.round(vLin * (L - 1) + m), 0, L - 1);
          d[pi] = d[pi + 1] = d[pi + 2] = outLevels[qi];
        } else {
          for (let k = 0; k < 3; k++) {
            const vLin = srgbToLin(d[si + k]);
            const qi = clamp(Math.round(vLin * (L - 1) + m), 0, L - 1);
            d[pi + k] = outLevels[qi];
          }
        }
      }
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- gradient map
const gradientMap: Op = (canvas, p) => {
  const stops = pstops(p, "stops");
  if (stops.length < 2) return;
  const amount = pn(p, "amount", 1);
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  // build 256-entry LUT
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = sorted[0],
      b = sorted[sorted.length - 1];
    for (let s = 0; s < sorted.length - 1; s++) {
      if (t >= sorted[s].t && t <= sorted[s + 1].t) {
        a = sorted[s];
        b = sorted[s + 1];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const k = clamp((t - a.t) / span, 0, 1);
    const ca = hexRGB(a.color),
      cb = hexRGB(b.color);
    lut[i * 3] = lerp(ca[0], cb[0], k);
    lut[i * 3 + 1] = lerp(ca[1], cb[1], k);
    lut[i * 3 + 2] = lerp(ca[2], cb[2], k);
  }
  const { ctx, img, d } = getData(canvas);
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.round(luma(d[i], d[i + 1], d[i + 2]));
    d[i] = lerp(d[i], lut[l * 3], amount);
    d[i + 1] = lerp(d[i + 1], lut[l * 3 + 1], amount);
    d[i + 2] = lerp(d[i + 2], lut[l * 3 + 2], amount);
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- threshold
const threshold: Op = (canvas, p) => {
  const level = pn(p, "level", 0.5) * 255;
  const amount = pn(p, "amount", 1);
  const { ctx, img, d } = getData(canvas);
  for (let i = 0; i < d.length; i += 4) {
    const v = luma601(d[i], d[i + 1], d[i + 2]) >= level ? 255 : 0;
    d[i] = lerp(d[i], v, amount);
    d[i + 1] = lerp(d[i + 1], v, amount);
    d[i + 2] = lerp(d[i + 2], v, amount);
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- grayscale
const grayscale: Op = (canvas, p) => {
  const a = pn(p, "amount", 1);
  const { ctx, img, d } = getData(canvas);
  for (let i = 0; i < d.length; i += 4) {
    const l = luma601(d[i], d[i + 1], d[i + 2]);
    d[i] = lerp(d[i], l, a);
    d[i + 1] = lerp(d[i + 1], l, a);
    d[i + 2] = lerp(d[i + 2], l, a);
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- grain
// Seeded (mulberry32) so a still export repeats byte-for-byte and tiling holds.
// `animate` advances the seed per frame (24/s cadence, matching the dither
// temporal spec) instead of relying on Math.random — deterministic AND animated.
const grain: Op = (canvas, p, u, t) => {
  const amount = pn(p, "amount", 0.14);
  if (amount <= 0) return;
  const size = Math.max(1, pn(p, "size", 1.5) * u);
  const mono = pb(p, "mono", true);
  const blend = ps(p, "blend", "soft-light");
  const seed = Math.round(pn(p, "seed", 1));
  const frame = pb(p, "animate", true) && t !== undefined ? Math.floor(t * 24) : 0;
  const rnd = mulberry32((Math.imul(seed, 2654435761) ^ Math.imul(frame + 1, 40503)) >>> 0);
  const W = canvas.width,
    H = canvas.height;
  const nw = Math.max(1, Math.round(W / size)),
    nh = Math.max(1, Math.round(H / size));
  const nz = tmpCanvas(canvas, nw, nh);
  const nctx = ctx2d(nz);
  const id = nctx.createImageData(nw, nh),
    n = id.data;
  for (let i = 0; i < n.length; i += 4) {
    if (mono) {
      const v = rnd() * 255;
      n[i] = n[i + 1] = n[i + 2] = v;
    } else {
      n[i] = rnd() * 255;
      n[i + 1] = rnd() * 255;
      n[i + 2] = rnd() * 255;
    }
    n[i + 3] = 255;
  }
  nctx.putImageData(id, 0, 0);
  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.globalCompositeOperation = blend as GlobalCompositeOperation;
  ctx.imageSmoothingEnabled = size > 1.5;
  ctx.drawImage(nz, 0, 0, W, H);
  ctx.restore();
};

// ---------------------------------------------------------------- tint
const tint: Op = (canvas, p) => {
  const opacity = pn(p, "opacity", 0.25);
  if (opacity <= 0) return;
  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = ps(p, "blend", "multiply") as GlobalCompositeOperation;
  ctx.fillStyle = ps(p, "color", "#000000");
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
};

// ---------------------------------------------------------------- chromatic aberration / dispersion
// quality "high" runs a 6-wavelength (rygcbv) dispersion instead of the normal
// 3-channel (RGB) one — see GL `chromatic` pass in shaders.ts for the mirrored
// spec (same wavelength multipliers, same pseudo-channel math, same
// reconstruction). Normal-mode path is unchanged from before quality existed.
const chromatic: Op = (canvas, p, u) => {
  const amt = pn(p, "amount", 4) * u;
  if (amt <= 0) return;
  const mode = ps(p, "mode", "radial");
  const radial = mode === "radial";
  const angle = mode === "split" ? 0 : (pn(p, "angle", 0) * Math.PI) / 180;
  const N = Math.max(1, Math.round(pn(p, "samples", 1)));
  const sat = pn(p, "saturation", 1);
  const high = ps(p, "quality", "normal") === "high";
  const { ctx, img, d, W, H } = getData(canvas);
  const src = new Uint8ClampedArray(d);
  const cx = W / 2, cy = H / 2;
  const ax = Math.cos(angle), ay = Math.sin(angle);
  const sampleCh = (x: number, y: number, k: number) => {
    const xi = clamp(Math.round(x), 0, W - 1), yi = clamp(Math.round(y), 0, H - 1);
    return src[(yi * W + xi) * 4 + k] / 255;
  };
  const sampleRGB = (x: number, y: number) => {
    const xi = clamp(Math.round(x), 0, W - 1), yi = clamp(Math.round(y), 0, H - 1);
    const pi = (yi * W + xi) * 4;
    return [src[pi] / 255, src[pi + 1] / 255, src[pi + 2] / 255] as const;
  };
  // hoisted per-slide offsets: (amt+slide) doesn't depend on the pixel, so
  // precompute once per N rather than recomputing per pixel in the inner loop.
  const slides = new Array<number>(N);
  for (let i = 0; i < N; i++) slides[i] = amt + (i / N) * 0.1;
  if (high) {
    // 6-wavelength (rygcbv) multipliers: r..v spans the same 1..3 range as
    // the normal mode's R×1/G×2/B×3, subdivided into 6 steps.
    const MULT = [1.0, 1.4, 1.8, 2.2, 2.6, 3.0]; // r y g c b v
    const off = new Array<number>(N * 6);
    for (let i = 0; i < N; i++) for (let w = 0; w < 6; w++) off[i * 6 + w] = slides[i] * MULT[w];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let bx = ax, by = ay;
        if (radial) {
          const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
          bx = dx / len; by = dy / len;
        }
        let ra = 0, ya = 0, ga = 0, ca = 0, ba = 0, va = 0;
        for (let i = 0; i < N; i++) {
          const base = i * 6;
          let s = off[base + 0];
          let rgb = sampleRGB(x + bx * s, y + by * s);
          ra += rgb[0] / 2;
          s = off[base + 1];
          rgb = sampleRGB(x + bx * s, y + by * s);
          ya += (2 * rgb[0] + 2 * rgb[1] - rgb[2]) / 6;
          s = off[base + 2];
          rgb = sampleRGB(x + bx * s, y + by * s);
          ga += rgb[1] / 2;
          s = off[base + 3];
          rgb = sampleRGB(x + bx * s, y + by * s);
          ca += (2 * rgb[1] + 2 * rgb[2] - rgb[0]) / 6;
          s = off[base + 4];
          rgb = sampleRGB(x + bx * s, y + by * s);
          ba += rgb[2] / 2;
          s = off[base + 5];
          rgb = sampleRGB(x + bx * s, y + by * s);
          va += (2 * rgb[2] + 2 * rgb[0] - rgb[1]) / 6;
        }
        ra /= N; ya /= N; ga /= N; ca /= N; ba /= N; va /= N;
        const ar = ra + (2 * va + 2 * ya - ca) / 3;
        const ag = ga + (2 * ya + 2 * ca - va) / 3;
        const ab = ba + (2 * ca + 2 * va - ya) / 3;
        const lum = luma601(ar * 255, ag * 255, ab * 255) / 255;
        const fr = lum + (ar - lum) * sat;
        const fg = lum + (ag - lum) * sat;
        const fb = lum + (ab - lum) * sat;
        const pi = (y * W + x) * 4;
        d[pi]     = clamp(Math.round(fr * 255), 0, 255);
        d[pi + 1] = clamp(Math.round(fg * 255), 0, 255);
        d[pi + 2] = clamp(Math.round(fb * 255), 0, 255);
        // alpha unchanged (d[pi+3] stays from original ImageData)
      }
    ctx.putImageData(img, 0, 0);
    return;
  }
  // normal mode: multi-sample dispersion, R×1 G×2 B×3 per-channel multipliers
  const rOff = new Array<number>(N), gOff = new Array<number>(N), bOff = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    rOff[i] = slides[i] * 1;
    gOff[i] = slides[i] * 2;
    bOff[i] = slides[i] * 3;
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let bx = ax, by = ay; // base unit direction
      if (radial) {
        const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy) || 1;
        bx = dx / len; by = dy / len;
      }
      // multi-sample dispersion: R×1 G×2 B×3 per-channel multipliers
      let ar = 0, ag = 0, ab = 0;
      for (let i = 0; i < N; i++) {
        ar += sampleCh(x + bx * rOff[i], y + by * rOff[i], 0);
        ag += sampleCh(x + bx * gOff[i], y + by * gOff[i], 1);
        ab += sampleCh(x + bx * bOff[i], y + by * bOff[i], 2);
      }
      ar /= N; ag /= N; ab /= N;
      // saturation: mix(luma, rgb, sat) — luma-preserving; luma601 expects 0..255 but we're 0..1 so scale
      const lum = luma601(ar * 255, ag * 255, ab * 255) / 255;
      const fr = lum + (ar - lum) * sat;
      const fg = lum + (ag - lum) * sat;
      const fb = lum + (ab - lum) * sat;
      const pi = (y * W + x) * 4;
      d[pi]     = clamp(Math.round(fr * 255), 0, 255);
      d[pi + 1] = clamp(Math.round(fg * 255), 0, 255);
      d[pi + 2] = clamp(Math.round(fb * 255), 0, 255);
      // alpha unchanged (d[pi+3] stays from original ImageData)
    }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- scanlines / CRT
const scanlines: Op = (canvas, p, u) => {
  const spacing = Math.max(1, pn(p, "spacing", 3) * u);
  const intensity = pn(p, "intensity", 0.3);
  if (intensity <= 0) return;
  const rgbCells = pb(p, "rgbCells", false);
  const { ctx, img, d, W, H } = getData(canvas);
  for (let y = 0; y < H; y++) {
    const wave = (Math.sin((y / spacing) * Math.PI * 2) * 0.5 + 0.5) * intensity;
    const f = 1 - wave;
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) * 4;
      d[pi] *= f;
      d[pi + 1] *= f;
      d[pi + 2] *= f;
      if (rgbCells) {
        const c = x % 3;
        d[pi] *= c === 0 ? 1 : 0.7;
        d[pi + 1] *= c === 1 ? 1 : 0.7;
        d[pi + 2] *= c === 2 ? 1 : 0.7;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- vignette
const vignette: Op = (canvas, p) => {
  const amount = pn(p, "amount", 0.4);
  if (amount <= 0) return;
  const radius = pn(p, "radius", 0.75);
  const softness = pn(p, "softness", 0.45);
  const W = canvas.width,
    H = canvas.height;
  const ctx = ctx2d(canvas);
  const max = Math.hypot(W, H) / 2;
  const inner = radius * (1 - softness) * max;
  const outer = radius * max + softness * max;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.max(0, inner), W / 2, H / 2, Math.max(inner + 1, outer));
  const [r, gr, b] = hexRGB(ps(p, "color", "#000000"));
  g.addColorStop(0, `rgba(${r},${gr},${b},0)`);
  g.addColorStop(1, `rgba(${r},${gr},${b},${amount})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
};

// ---------------------------------------------------------------- bloom / glow
const bloom: Op = (canvas, p, u) => {
  const intensity = pn(p, "intensity", 0.5);
  if (intensity <= 0) return;
  const thr = pn(p, "threshold", 0.7) * 255;
  // quality:"dual" is a GL-only look (mip-chain dual filter) — DIVERGENCE
  // ACCEPTED by decision (blur-family Skia precedent): the CPU renders its
  // gaussian pipeline at an equivalent visual radius instead of hand-emulating
  // bilinear 13/9-tap kernels across three mip levels. GL is the preview look
  // authority for dual; still export gets this gaussian look.
  const dual = ps(p, "quality", "gaussian") === "dual";
  const radius = Math.max(0.5, pn(p, "radius", 12) * u) * (dual ? 1.4 : 1);
  const W = canvas.width,
    H = canvas.height;
  // extract bright areas
  const bright = tmpCanvas(canvas, W, H);
  const bctx = ctx2d(bright);
  bctx.drawImage(canvas, 0, 0);
  const bi = bctx.getImageData(0, 0, W, H),
    bd = bi.data;
  for (let i = 0; i < bd.length; i += 4) {
    const l = luma601(bd[i], bd[i + 1], bd[i + 2]);
    if (l < thr) {
      bd[i] = bd[i + 1] = bd[i + 2] = 0;
    }
  }
  bctx.putImageData(bi, 0, 0);
  // blur the bright pass
  const blurred = tmpCanvas(canvas, W, H);
  const blctx = ctx2d(blurred);
  blctx.filter = `blur(${radius}px)`;
  blctx.drawImage(bright, 0, 0);
  blctx.filter = "none";
  // screen it back
  const ctx = ctx2d(canvas);
  ctx.save();
  ctx.globalAlpha = clamp(intensity, 0, 1);
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(blurred, 0, 0);
  ctx.restore();
};

// ---------------------------------------------------------------- sharpen
const sharpen: Op = (canvas, p) => {
  const amount = pn(p, "amount", 0.6);
  if (amount <= 0) return;
  const { ctx, img, d, W, H } = getData(canvas);
  const src = new Uint8ClampedArray(d);
  const at = (x: number, y: number, k: number) =>
    src[(clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4 + k];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const pi = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const lapl =
          at(x, y, k) * 5 - at(x - 1, y, k) - at(x + 1, y, k) - at(x, y - 1, k) - at(x, y + 1, k);
        d[pi + k] = clamp(lerp(src[pi + k], lapl, amount), 0, 255);
      }
    }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- displace / warp
const displace: Op = (canvas, p, u) => {
  const amt = pn(p, "amount", 12) * u;
  if (amt <= 0) return;
  const scale = Math.max(0.5, pn(p, "scale", 3) * u) * 20;
  const type = ps(p, "type", "noise");
  const { ctx, img, d, W, H } = getData(canvas);
  const src = new Uint8ClampedArray(d);
  const sample = (x: number, y: number, k: number) =>
    src[(clamp(Math.round(y), 0, H - 1) * W + clamp(Math.round(x), 0, W - 1)) * 4 + k];
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let dx: number, dy: number;
      if (type === "sine") {
        dx = Math.sin(y / scale) * amt;
        dy = Math.cos(x / scale) * amt;
      } else {
        dx = (hash(Math.floor(x / scale), Math.floor(y / scale)) - 0.5) * 2 * amt;
        dy = (hash(Math.floor(x / scale) + 99, Math.floor(y / scale) + 17) - 0.5) * 2 * amt;
      }
      const pi = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) d[pi + k] = sample(x + dx, y + dy, k);
    }
  ctx.putImageData(img, 0, 0);
};

// ---------------------------------------------------------------- halftone
// Per-pixel analytic halftone — the exact mirror of the GL pass (shaders.ts),
// per the roadmap §2 parity contract: ONE lattice/sampling/AA spec, two
// implementations. Canvas vector fills were replaced because Skia's analytic
// area AA can never equal a shader's coverage function (the ~12/255 mean
// parity gap the harness found); with both engines evaluating the same
// per-pixel math the diff is float-rounding only (≤1 LSB).
// Spec (must stay in lockstep with the GL shader):
//   lattice   screen rotated about the canvas centre; first cell-centre at
//             A = -diag/2 + cell/2, diag = ceil(hypot(W,H)) (legacy CPU phase)
//   sampling  source read at the cell-centre texel: clamp(floor(Pc+0.5)),
//             NEAREST, coverage in PERCEPTUAL sRGB luma601 (not linear)
//   radius    r = sqrt(cov^contrast)*0.71*(1 + overflow*0.9) in cell units;
//             skip if r*cell<=0.2. overflow<=1 keeps r+smin growth < 1.5, the
//             3x3 neighbourhood's coverage bound — do not raise the cap.
//   union     fold the SDFs over the pixel's 3x3 cell neighbourhood — hard
//             min, or iq smin (k = gooey*0.4 cell units) when gooey>0 — then
//             ONE aaCov(dPx) = clamp(0.5 - dPx, 0..1), a 1px linear area
//             ramp in px units. (Hard-min fold == the old per-dot coverage
//             max: aaCov is monotonic in d.)
//   CMYK      legacy (overflow=gooey=0): multiply mix(1, ink, aa) per
//             neighbour DOT per screen; with overflow/gooey: fold per SCREEN
//             then multiply once (merged dots must not double-ink).
//             Quantized ONCE at the end (matches GL float compositing).

// SDF in cell units; shape: 0 circle 1 ring 2 line 3 square 4 diamond
const HT_SHAPES = ["circle", "ring", "line", "square", "diamond"];
function htSDF(ccx: number, ccy: number, r: number, shape: number): number {
  if (shape === 3) return Math.max(Math.abs(ccx), Math.abs(ccy)) - r;
  if (shape === 4) return Math.abs(ccx) + Math.abs(ccy) - r;
  if (shape === 2) return Math.abs(ccy) - r * 0.5;
  const d = Math.sqrt(ccx * ccx + ccy * ccy);
  if (shape === 1) return Math.max(d - r, r * 0.55 - d);
  return d - r;
}

interface HtScreen {
  cs: number;
  sn: number;
  A: number;
  kmax: number;
  kw: number;
  grid: Float64Array; // r per cell (cell units), -1 = skipped dot
}

// Precompute one rotated screen's dot radii: one source sample + pow + sqrt
// per CELL (not per pixel), indexed [ky+1][kx+1] over the k-range any canvas
// pixel's 3x3 neighbourhood can touch.
function buildHtScreen(
  W: number,
  H: number,
  cell: number,
  angleDeg: number,
  contrast: number,
  stagger: boolean,
  overflow: number, // 0..1 — dot radius scale (1 + overflow*0.9)
  cov: (i: number) => number, // 0..1 coverage (invert applied) at src byte index
): HtScreen {
  const ang = (angleDeg * Math.PI) / 180;
  const cs = Math.cos(ang),
    sn = Math.sin(ang);
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  const A = -diag / 2 + cell / 2;
  const kmax = Math.ceil(diag / cell);
  const kw = kmax + 3; // k in [-1, kmax+1]
  const rScale = 0.71 * (1 + overflow * 0.9);
  const grid = new Float64Array(kw * kw).fill(-1);
  for (let ky = -1; ky <= kmax + 1; ky++) {
    // GLSL mod(): result is non-negative for negative ky
    const rowOff = stagger && ((ky % 2) + 2) % 2 === 1 ? cell / 2 : 0;
    const Cy = A + ky * cell;
    for (let kx = -1; kx <= kmax + 1; kx++) {
      const Cx = A + rowOff + kx * cell;
      const Pcx = cs * Cx - sn * Cy + W / 2;
      const Pcy = sn * Cx + cs * Cy + H / 2;
      const ix = clamp(Math.floor(Pcx + 0.5), 0, W - 1);
      const iy = clamp(Math.floor(Pcy + 0.5), 0, H - 1);
      const c = Math.pow(clamp(cov((iy * W + ix) * 4), 0, 1), contrast);
      const r = Math.sqrt(c) * rScale;
      grid[(ky + 1) * kw + (kx + 1)] = r * cell <= 0.2 ? -1 : r;
    }
  }
  return { cs, sn, A, kmax, kw, grid };
}

// iq polynomial smooth-min — the gooey dot merge (k in cell units, k>0).
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Fold one screen's SDFs over every pixel's 3x3 neighbourhood and emit ONE
// combined coverage per pixel (hard min, or smin when gooeyK>0). The GL
// shader folds the identical dot set — the fold must include every
// non-skipped dot (no early aa reject: distant dots still pull an smin).
function runHtScreen(
  W: number,
  H: number,
  cell: number,
  stagger: boolean,
  shape: number,
  gooeyK: number, // smin k in cell units; 0 = hard min
  s: HtScreen,
  blend: (px: number, aa: number) => void,
) {
  const { cs, sn, A, kmax, kw, grid } = s;
  const halfW = W / 2,
    halfH = H / 2;
  const invCell = 1 / cell;
  for (let y = 0; y < H; y++) {
    const dY = y + 0.5 - halfH;
    for (let x = 0; x < W; x++) {
      const dX = x + 0.5 - halfW;
      const Qx = cs * dX + sn * dY;
      const Qy = -sn * dX + cs * dY;
      const kx0 = Math.floor((Qx - A) * invCell + 0.5);
      const ky0 = Math.floor((Qy - A) * invCell + 0.5);
      const px = y * W + x;
      let dAcc = 1e9;
      for (let dy = -1; dy <= 1; dy++) {
        const ky = ky0 + dy;
        if (ky < -1 || ky > kmax + 1) continue;
        const rowOff = stagger && ((ky % 2) + 2) % 2 === 1 ? cell / 2 : 0;
        const ccy = (Qy - (A + ky * cell)) * invCell;
        const rowBase = (ky + 1) * kw + 1;
        for (let dx = -1; dx <= 1; dx++) {
          const kx = kx0 + dx;
          if (kx < -1 || kx > kmax + 1) continue;
          const r = grid[rowBase + kx];
          if (r < 0) continue;
          const ccx = (Qx - (A + rowOff + kx * cell)) * invCell;
          const d = htSDF(ccx, ccy, r, shape);
          // smin(1e9, d, k) degenerates to plain min — no init guard needed
          dAcc = gooeyK > 0 ? smin(dAcc, d, gooeyK) : Math.min(dAcc, d);
        }
      }
      const aa = 0.5 - dAcc * cell;
      if (aa <= 0) continue;
      blend(px, aa >= 1 ? 1 : aa);
    }
  }
}

// Per-DOT variant — the legacy CMYK compositing (each neighbour dot
// multiplies its ink independently; kept bit-stable for overflow=gooey=0).
function runHtScreenPerDot(
  W: number,
  H: number,
  cell: number,
  stagger: boolean,
  shape: number,
  s: HtScreen,
  blend: (px: number, aa: number) => void,
) {
  const { cs, sn, A, kmax, kw, grid } = s;
  const halfW = W / 2,
    halfH = H / 2;
  const invCell = 1 / cell;
  for (let y = 0; y < H; y++) {
    const dY = y + 0.5 - halfH;
    for (let x = 0; x < W; x++) {
      const dX = x + 0.5 - halfW;
      const Qx = cs * dX + sn * dY;
      const Qy = -sn * dX + cs * dY;
      const kx0 = Math.floor((Qx - A) * invCell + 0.5);
      const ky0 = Math.floor((Qy - A) * invCell + 0.5);
      const px = y * W + x;
      for (let dy = -1; dy <= 1; dy++) {
        const ky = ky0 + dy;
        if (ky < -1 || ky > kmax + 1) continue;
        const rowOff = stagger && ((ky % 2) + 2) % 2 === 1 ? cell / 2 : 0;
        const ccy = (Qy - (A + ky * cell)) * invCell;
        const rowBase = (ky + 1) * kw + 1;
        for (let dx = -1; dx <= 1; dx++) {
          const kx = kx0 + dx;
          if (kx < -1 || kx > kmax + 1) continue;
          const r = grid[rowBase + kx];
          if (r < 0) continue;
          const ccx = (Qx - (A + rowOff + kx * cell)) * invCell;
          const d = htSDF(ccx, ccy, r, shape);
          const aa = 0.5 - d * cell;
          if (aa <= 0) continue;
          blend(px, aa >= 1 ? 1 : aa);
        }
      }
    }
  }
}

// rgb2cmyk: reference separation with K extraction (all in 0..1 linear).
// Guard k==1 (pure black) to avoid divide-by-zero.
function rgb2cmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = Math.min(1 - r, 1 - g, 1 - b);
  if (k >= 1) return [0, 0, 0, 1];
  const denom = 1 - k;
  return [(1 - r - k) / denom, (1 - g - k) / denom, (1 - b - k) / denom, k];
}

const halftone: Op = (canvas, p, u) => {
  const cell = Math.max(2, pn(p, "cell", 9) * u);
  const angle = pn(p, "angle", 45);
  const contrast = pn(p, "contrast", 1);
  const shape = Math.max(0, HT_SHAPES.indexOf(ps(p, "dotShape", "circle")));
  const mode = ps(p, "mode", "mono");
  const stagger = pb(p, "stagger", false);
  const invertCells = pb(p, "invertCells", false);
  const overflow = clamp(pn(p, "overflow", 0), 0, 1);
  const gooeyK = clamp(pn(p, "gooey", 0), 0, 1) * 0.4; // smin k, cell units
  const W = canvas.width,
    H = canvas.height;
  const ctx = ctx2d(canvas);
  const src = ctx.getImageData(0, 0, W, H).data;
  const out = ctx.createImageData(W, H);
  const o = out.data;

  if (mode === "cmyk") {
    // White paper; ink layers multiply in float, quantized once at the end —
    // exactly the GL compositing order. Legacy path multiplies per neighbour
    // DOT; overflow/gooey fold per SCREEN first (merged dots single-ink).
    const combined = overflow > 0 || gooeyK > 0;
    const res = new Float64Array(W * H * 3).fill(1);
    const screens: { ink: [number, number, number]; angle: number; chan: number }[] = [
      { ink: [0x00 / 255, 0xae / 255, 0xef / 255], angle: 15, chan: 0 },
      { ink: [0xec / 255, 0x00 / 255, 0x8c / 255], angle: 75, chan: 1 },
      { ink: [0xff / 255, 0xf2 / 255, 0x00 / 255], angle: 0, chan: 2 },
      { ink: [0x1a / 255, 0x1a / 255, 0x1a / 255], angle: 45, chan: 3 },
    ];
    for (const scr of screens) {
      const cov = (i: number) => {
        const cmyk = rgb2cmyk(src[i] / 255, src[i + 1] / 255, src[i + 2] / 255);
        const c = cmyk[scr.chan];
        return invertCells ? 1 - c : c;
      };
      const s = buildHtScreen(W, H, cell, scr.angle, contrast, stagger, overflow, cov);
      const [ir, ig, ib] = scr.ink;
      const blend = (px: number, aa: number) => {
        const j = px * 3;
        res[j] *= 1 + (ir - 1) * aa;
        res[j + 1] *= 1 + (ig - 1) * aa;
        res[j + 2] *= 1 + (ib - 1) * aa;
      };
      if (combined) runHtScreen(W, H, cell, stagger, shape, gooeyK, s, blend);
      else runHtScreenPerDot(W, H, cell, stagger, shape, s, blend);
    }
    for (let px = 0, n = W * H; px < n; px++) {
      const j = px * 3,
        k = px * 4;
      o[k] = Math.round(res[j] * 255);
      o[k + 1] = Math.round(res[j + 1] * 255);
      o[k + 2] = Math.round(res[j + 2] * 255);
      o[k + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return;
  }

  // mono: paper + single ink screen. Coverage from perceptual (sRGB) luminance,
  // so mid-gray maps to ~50% dot coverage. (Measuring in linear light over-inks
  // mid-tones and the whole screen reads too dark.)
  const [inkR, inkG, inkB] = hexRGB(ps(p, "ink", "#191512"));
  const [papR, papG, papB] = hexRGB(ps(p, "paper", "#f1ece4"));
  const cov = (i: number) => {
    const c = 1 - luma601(src[i], src[i + 1], src[i + 2]) / 255;
    return invertCells ? 1 - c : c;
  };
  const s = buildHtScreen(W, H, cell, angle, contrast, stagger, overflow, cov);
  const mask = new Float64Array(W * H);
  runHtScreen(W, H, cell, stagger, shape, gooeyK, s, (px, aa) => {
    if (aa > mask[px]) mask[px] = aa;
  });
  for (let px = 0, n = W * H; px < n; px++) {
    const m = mask[px],
      k = px * 4;
    o[k] = Math.round(papR + (inkR - papR) * m);
    o[k + 1] = Math.round(papG + (inkG - papG) * m);
    o[k + 2] = Math.round(papB + (inkB - papB) * m);
    o[k + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- receipt
// Thermal-printer scanline bars — the exact per-pixel mirror of the GL pass
// (shaders.ts `receipt`). Spec (must stay in lockstep):
//   band      period = max(2, round(size*u)) px; band = floor(y/period);
//             bandCenterRow = min(H-1, floor(band*period + period/2)) — an
//             INTEGER row (NEAREST source read, no interpolation).
//   coverage  luma601 of src at (x, bandCenterRow); cov = (1-luma)^contrast
//             is the ink coverage for THIS COLUMN of the band.
//   bar SDF   d = |y - (band*period + period/2 - 0.5)| - cov*period/2, in px;
//             mask = aaCov(d) — the halftone 1px linear ramp (see halftone
//             block comment above): clamp(0.5 - d, 0, 1).
//   out       mix(paper, ink, mask) per pixel.
const receipt: Op = (canvas, p, u) => {
  const { ctx, img, d: src, W, H } = getData(canvas);
  const period = Math.max(2, Math.round(pn(p, "size", 5) * u));
  const contrast = pn(p, "contrast", 1.2);
  const [inkR, inkG, inkB] = hexRGB(ps(p, "ink", "#1a1a1a"));
  const [papR, papG, papB] = hexRGB(ps(p, "paper", "#f6f3ea"));
  const out = ctx.createImageData(W, H);
  const o = out.data;
  // aaCov: the shared halftone 1px linear area ramp on an SDF in px units.
  const aaCov = (dPx: number) => clamp(0.5 - dPx, 0, 1);
  for (let y = 0; y < H; y++) {
    const band = Math.floor(y / period);
    const bandCenterRow = Math.min(H - 1, Math.floor(band * period + period / 2));
    const barCenterY = band * period + period / 2 - 0.5;
    for (let x = 0; x < W; x++) {
      const si = (bandCenterRow * W + x) * 4;
      const lum = luma601(src[si], src[si + 1], src[si + 2]) / 255;
      const cov = Math.pow(clamp(1 - lum, 0, 1), contrast);
      const dPx = Math.abs(y - barCenterY) - (cov * period) / 2;
      const mask = aaCov(dPx);
      const di = (y * W + x) * 4;
      o[di] = Math.round(papR + (inkR - papR) * mask);
      o[di + 1] = Math.round(papG + (inkG - papG) * mask);
      o[di + 2] = Math.round(papB + (inkB - papB) * mask);
      o[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- flutedGlass
// Vertical reeded-glass ribs — the exact per-pixel mirror of the GL pass
// (shaders.ts `flutedGlass`). Spec (must stay in lockstep):
//   rib       w = max(2, round(size*u)); xi = floor(x); ribX = xi - w*floor(xi/w)
//             (integer mod, matches GLSL mod() for non-negative xi); t = (ribX+0.5)/w - 0.5.
//   refract   dx = sin(t*PI)*amount*w*0.6 (continuous — sin of a bounded value is allowed).
//   sample    sx = x + dx; MANUAL 2-tap horizontal bilinear: x0 = floor(sx),
//             frac = sx-x0, NEAREST reads at clamp(x0) and clamp(x0+1), mixed by frac.
//             (never hardware LINEAR — its interpolant quantizes differently per GPU.)
//   specular  h = specular * max(cos(PI*(t-0.15)), 0)^24 — additive per channel.
//   out       clamp(sampled + h, 0, 1).
const flutedGlass: Op = (canvas, p, u) => {
  const { ctx, img, d: src, W, H } = getData(canvas);
  const w = Math.max(2, Math.round(pn(p, "size", 18) * u));
  const amount = pn(p, "amount", 0.5);
  const specular = pn(p, "specular", 0.35);
  const out = ctx.createImageData(W, H);
  const o = out.data;
  const readNearest = (xi: number, y: number, ch: number) => {
    const cx = xi < 0 ? 0 : xi > W - 1 ? W - 1 : xi;
    return src[(y * W + cx) * 4 + ch];
  };
  for (let x = 0; x < W; x++) {
    const xi = Math.floor(x);
    const ribX = xi - w * Math.floor(xi / w);
    const t = (ribX + 0.5) / w - 0.5;
    const dx = Math.sin(t * Math.PI) * amount * w * 0.6;
    const hMag = Math.pow(Math.max(Math.cos(Math.PI * (t - 0.15)), 0), 24) * specular;
    for (let y = 0; y < H; y++) {
      const sx = x + dx;
      const x0 = Math.floor(sx);
      const frac = sx - x0;
      const di = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const a = readNearest(x0, y, ch);
        const b = readNearest(x0 + 1, y, ch);
        const sampled = a + (b - a) * frac;
        o[di + ch] = clamp(Math.round(sampled + hMag * 255), 0, 255);
      }
      o[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- ledPanel
// RGB sub-pixel LED matrix — the exact per-pixel mirror of the GL pass
// (shaders.ts `ledPanel`). Spec (must stay in lockstep):
//   cell      cell = max(4, round(size*u)); integer px x=floor(px.x), y=floor(px.y).
//   stagger   cx = floor(x/cell); if stagger && cx odd: yEff = y + floor(cell/2)
//             else yEff = y; cy = floor(yEff/cell). lx = x - cx*cell,
//             ly = yEff - cy*cell (cell-local ints).
//   sample    NEAREST src at the cell's drawn visual center: sxc = min(W-1,
//             cx*cell + floor(cell/2)); syc = min(H-1, cy*cell + floor(cell/2)
//             - (stagger && cx odd ? floor(cell/2) : 0)) — undoes the stagger
//             shift so the sample lands on the unstaggered image.
//   strips    bezel inset b = round(gap*cell*0.5); inX0 = b, inW = cell-2b,
//             inY0 = b, inY1 = cell-b. 3 vertical strips (R,G,B) each
//             inW/3 wide with a 1px gap on either side; strip k's rect:
//             x in [inX0 + k*inW/3 + 0.5, inX0 + (k+1)*inW/3 - 0.5],
//             y in [b, cell-b]. dPx = axis-aligned box SDF (in px) from
//             (lx+0.5, ly+0.5) to that rect; mask = aaCov(dPx).
//   emissive  k = which third lx falls in (only evaluate that strip — they're
//             disjoint); v = src channel k (0..1); contribution = primary_k*v*mask.
//   glow      out = stripContribution + glow*0.12*srcRGB (faint full-cell wash),
//             clamped 0..1 per channel. Bezel background is black + the wash.
const ledPanel: Op = (canvas, p, u) => {
  const { ctx, img, d: src, W, H } = getData(canvas);
  const cell = Math.max(4, Math.round(pn(p, "size", 14) * u));
  const gap = pn(p, "gap", 0.18);
  const stagger = pb(p, "stagger", false);
  const glow = pn(p, "glow", 0.25);
  const half = Math.floor(cell / 2);
  const b = Math.round(gap * cell * 0.5);
  const inX0 = b;
  const inW = cell - 2 * b;
  const inY0 = b;
  const inY1 = cell - b;
  const out = ctx.createImageData(W, H);
  const o = out.data;
  const aaCov = (dPx: number) => clamp(0.5 - dPx, 0, 1);
  const primaries: [number, number, number][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = Math.floor(x / cell);
      const oddCol = (((cx % 2) + 2) % 2) === 1;
      const yEff = stagger && oddCol ? y + half : y;
      const cy = Math.floor(yEff / cell);
      const lx = x - cx * cell;
      const ly = yEff - cy * cell;
      const sxc = Math.min(W - 1, cx * cell + half);
      const syc = Math.min(H - 1, cy * cell + half - (stagger && oddCol ? half : 0));
      const si = (syc * W + sxc) * 4;
      const srcR = src[si] / 255,
        srcG = src[si + 1] / 255,
        srcB = src[si + 2] / 255;
      let rC = 0,
        gC = 0,
        bC = 0;
      if (inW > 0 && lx >= inX0 && lx < cell - inX0 && ly >= inY0 && ly < inY1) {
        let k = Math.floor(((lx - inX0) * 3) / inW);
        if (k < 0) k = 0;
        if (k > 2) k = 2;
        const rx0 = inX0 + (k * inW) / 3 + 0.5;
        const rx1 = inX0 + ((k + 1) * inW) / 3 - 0.5;
        const ry0 = inY0;
        const ry1 = inY1;
        const cx0 = (rx0 + rx1) / 2,
          hx = (rx1 - rx0) / 2;
        const cy0 = (ry0 + ry1) / 2,
          hy = (ry1 - ry0) / 2;
        const px = lx + 0.5 - cx0,
          py = ly + 0.5 - cy0;
        const ddx = Math.abs(px) - hx,
          ddy = Math.abs(py) - hy;
        const dPx = Math.sqrt(Math.max(ddx, 0) ** 2 + Math.max(ddy, 0) ** 2) + Math.min(Math.max(ddx, ddy), 0);
        const mask = aaCov(dPx);
        const v = k === 0 ? srcR : k === 1 ? srcG : srcB;
        const [pr, pg, pb2] = primaries[k];
        rC = pr * v * mask;
        gC = pg * v * mask;
        bC = pb2 * v * mask;
      }
      rC += glow * 0.12 * srcR;
      gC += glow * 0.12 * srcG;
      bC += glow * 0.12 * srcB;
      const di = (y * W + x) * 4;
      o[di] = Math.round(clamp(rC, 0, 1) * 255);
      o[di + 1] = Math.round(clamp(gC, 0, 1) * 255);
      o[di + 2] = Math.round(clamp(bC, 0, 1) * 255);
      o[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- crochet
// Yarn V-stitch lattice — the exact per-pixel mirror of the GL pass
// (shaders.ts `crochet`). Spec (must stay in lockstep):
//   cell      cell = max(6, round(size*u)); integer px.
//   brick     row = floor(y/cell); xEff = x + (row odd ? floor(cell/2) : 0);
//             col = floor(xEff/cell); lx = xEff - col*cell, ly = y - row*cell.
//             p = (lx - cell/2 + 0.5, ly - cell/2 + 0.5) — centered local px.
//   sample    NEAREST src at the stitch's drawn visual center: sxc = clamp(
//             col*cell + floor(cell/2) - (row odd ? floor(cell/2) : 0), 0, W-1);
//             syc = clamp(row*cell + floor(cell/2), 0, H-1).
//             yarn = clamp(src*1.08, 0..1) (warmed/saturated, multiplicative).
//   V stitch  two lobes s in {-1,+1} at constant angle 38° (cosA/sinA computed
//             once in f64, not per-pixel data-dependent trig): q = (p.x +
//             s*cell*0.14, p.y); rotate q by s*38°: pr = (cA*q.x - s*sA*q.y,
//             s*sA*q.x + cA*q.y); squash: pe = (pr.x, pr.y/0.55); d =
//             length(pe) - cell*0.30; dPx = abs(d) - yarnWidth*cell*0.5;
//             mask_s = aaCov(dPx). mask = max(mask_-1, mask_+1).
//   out       mix(paper, yarn, mask).
const DEG38 = (38 * Math.PI) / 180;
const COS38 = Math.cos(DEG38);
const SIN38 = Math.sin(DEG38);
const crochet: Op = (canvas, p, u) => {
  const { ctx, img, d: src, W, H } = getData(canvas);
  const cell = Math.max(6, Math.round(pn(p, "size", 18) * u));
  const yarnWidth = pn(p, "yarnWidth", 0.3);
  const [papR, papG, papB] = hexRGB(ps(p, "paper", "#2a2320"));
  const half = Math.floor(cell / 2);
  const out = ctx.createImageData(W, H);
  const o = out.data;
  const aaCov = (dPx: number) => clamp(0.5 - dPx, 0, 1);
  const ringR = cell * 0.3;
  const strokeHalf = yarnWidth * cell * 0.5;
  const lobeOffset = cell * 0.14;
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / cell);
    const oddRow = (((row % 2) + 2) % 2) === 1;
    const ly = y - row * cell;
    for (let x = 0; x < W; x++) {
      const xEff = x + (oddRow ? half : 0);
      const col = Math.floor(xEff / cell);
      const lx = xEff - col * cell;
      const px = lx - cell / 2 + 0.5;
      const py = ly - cell / 2 + 0.5;
      const sxc = clamp(col * cell + half - (oddRow ? half : 0), 0, W - 1);
      const syc = clamp(row * cell + half, 0, H - 1);
      const si = (syc * W + sxc) * 4;
      const yarnR = clamp(Math.round(src[si] * 1.08), 0, 255);
      const yarnG = clamp(Math.round(src[si + 1] * 1.08), 0, 255);
      const yarnB = clamp(Math.round(src[si + 2] * 1.08), 0, 255);
      let mask = 0;
      for (const s of [-1, 1]) {
        const qx = px + s * lobeOffset;
        const qy = py;
        const prx = COS38 * qx - s * SIN38 * qy;
        const pry = s * SIN38 * qx + COS38 * qy;
        const pex = prx;
        const pey = pry / 0.55;
        const d = Math.sqrt(pex * pex + pey * pey) - ringR;
        const dPx = Math.abs(d) - strokeHalf;
        const m = aaCov(dPx);
        if (m > mask) mask = m;
      }
      const di = (y * W + x) * 4;
      o[di] = Math.round(papR + (yarnR - papR) * mask);
      o[di + 1] = Math.round(papG + (yarnG - papG) * mask);
      o[di + 2] = Math.round(papB + (yarnB - papB) * mask);
      o[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
};

// ---------------------------------------------------------------- lightRays
// Screen-space crepuscular rays (Heckel volumetric-lighting, 2D subset +
// GPU Gems 3 ch.13): bright pixels are emitters; each pixel gathers N samples
// along the ray toward the light with Beer-style decay. ONE spec with the GL
// pass: bright threshold uses bloom's exact 8-bit snap; sample positions are
// integer texel picks floor(p + delta*(i + t0) + 0.5) idx-clamped; t0 is a
// per-pixel blue-noise ray phase (shared BLUE_NOISE_128 table) that hides
// banding at low sample counts. Parity tier is statistical (rare f32/f64
// floor ties on sample positions), targets in ParityClient.
const lightRays: Op = (canvas, p) => {
  const strength = pn(p, "strength", 0.7);
  if (strength <= 0) return;
  const { ctx, img, d, W, H } = getData(canvas);
  const N = Math.max(1, Math.round(pn(p, "samples", 32)));
  const thr255 = pn(p, "threshold", 0.6) * 255;
  const density = pn(p, "density", 0.8);
  const decay = pn(p, "decay", 0.95);
  const lx = (pn(p, "x", 50) / 100) * W;
  const ly = (pn(p, "y", 25) / 100) * H;
  const [cr, cg, cb] = hexRGB(ps(p, "color", "#ffe3b8"));
  // geometric-series normalization keeps perceived energy stable across N/decay
  const norm = decay < 1 ? (1 - decay) / (1 - Math.pow(decay, N)) : 1 / N;
  const k = (strength * norm) / 255; // bright buffer holds bytes; fold /255 in
  const kr = (k * cr) / 255;
  const kg = (k * cg) / 255;
  const kb = (k * cb) / 255;
  const screen = ps(p, "blend", "screen") === "screen";

  // hoisted bright pass — identical to thresholding inline per sample (the
  // decision is deterministic per texel), avoids re-computing luma N times
  const bright = new Float32Array(W * H * 3);
  for (let px = 0, i = 0; px < W * H; px++, i += 4) {
    if (luma601(d[i], d[i + 1], d[i + 2]) >= thr255) {
      const j = px * 3;
      bright[j] = d[i];
      bright[j + 1] = d[i + 1];
      bright[j + 2] = d[i + 2];
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t0 = (BLUE_NOISE_128[(y & 127) * 128 + (x & 127)] + 0.5) / 256;
      const dx = ((lx - x) * density) / N;
      const dy = ((ly - y) * density) / N;
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let w = 1;
      for (let i = 0; i < N; i++) {
        const sx = Math.min(W - 1, Math.max(0, Math.floor(x + dx * (i + t0) + 0.5)));
        const sy = Math.min(H - 1, Math.max(0, Math.floor(y + dy * (i + t0) + 0.5)));
        const j = (sy * W + sx) * 3;
        ar += bright[j] * w;
        ag += bright[j + 1] * w;
        ab += bright[j + 2] * w;
        w *= decay;
      }
      const rr = ar * kr;
      const rg = ag * kg;
      const rb = ab * kb;
      const pi = (y * W + x) * 4;
      if (screen) {
        d[pi] = 255 - (255 - d[pi]) * (1 - Math.min(1, rr));
        d[pi + 1] = 255 - (255 - d[pi + 1]) * (1 - Math.min(1, rg));
        d[pi + 2] = 255 - (255 - d[pi + 2]) * (1 - Math.min(1, rb));
      } else {
        d[pi] = Math.min(255, d[pi] + rr * 255);
        d[pi + 1] = Math.min(255, d[pi + 1] + rg * 255);
        d[pi + 2] = Math.min(255, d[pi + 2] + rb * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
};

export const OPS: Record<EffectType, Op> = {
  adjust,
  blur,
  pixelate,
  posterize,
  dither,
  halftone,
  gradientMap,
  threshold,
  grayscale,
  grain,
  tint,
  chromatic,
  scanlines,
  vignette,
  bloom,
  lightRays,
  sharpen,
  displace,
  // converters / styles (glyph family shares renderGlyph)
  ascii: renderGlyph,
  blockChars: renderGlyph,
  crosshatch: renderGlyph,
  diagonal: renderGlyph,
  diamond: renderGlyph,
  lines: renderGlyph,
  mixed: renderGlyph,
  glyphDots: renderGlyph,
  braille,
  mosaic,
  lego,
  receipt,
  flutedGlass,
  ledPanel,
  crochet,
  lineArt,
  kuwahara,
  // post parity
  crtCurvature,
  glitch,
  filmDust,
  characterBloom,
  // surface treatments (Editions light + paper)
  lightLeak,
  gobo,
  caustic,
  relief,
  stain,
};
