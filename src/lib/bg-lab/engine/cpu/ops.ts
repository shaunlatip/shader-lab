// BG Lab — CPU 2D-canvas effect ops. Each op mutates the canvas in place:
//   op(canvas, params, unit)  where unit = W/1000 (size-param scaling).
// Ported from public/explorations/asset-bg/index.html and extended.

import type { EffectType, GradientStop, ParamValue } from "../../types";
import {
  clamp,
  ctx2d,
  hexRGB,
  lerp,
  luma,
  luma601,
  linToSrgb,
  orderedThreshold,
  pb,
  pn,
  ps,
  pstops,
  recompose,
  srgbToLin,
  tmpCanvas,
} from "./util";

import { renderGlyph, braille, mosaic, lego, lineArt, kuwahara } from "./converters";
import { crtCurvature, glitch, filmDust, characterBloom } from "./postfx";

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
    return;
  }

  // gaussian (default)
  recompose(canvas, (ctx, snap) => {
    ctx.filter = `blur(${r}px)`;
    // overscan so the blur doesn't darken edges against transparency
    ctx.drawImage(snap, -r, -r, W + 2 * r, H + 2 * r);
    ctx.filter = "none";
  });
};

// ---------------------------------------------------------------- pixelate
const pixelate: Op = (canvas, p, u) => {
  const block = Math.max(1, pn(p, "size", 8) * u);
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
const dither: Op = (canvas, p, u) => {
  const type = ps(p, "type", "bayer4");
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
        const m = orderedThreshold(type, Math.floor(x / scale), Math.floor(y / scale)) - 0.5;
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
const grain: Op = (canvas, p, u) => {
  const amount = pn(p, "amount", 0.14);
  if (amount <= 0) return;
  const size = Math.max(1, pn(p, "size", 1.5) * u);
  const mono = pb(p, "mono", true);
  const blend = ps(p, "blend", "soft-light");
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
      const v = Math.random() * 255;
      n[i] = n[i + 1] = n[i + 2] = v;
    } else {
      n[i] = Math.random() * 255;
      n[i + 1] = Math.random() * 255;
      n[i + 2] = Math.random() * 255;
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
const chromatic: Op = (canvas, p, u) => {
  const amt = pn(p, "amount", 4) * u;
  if (amt <= 0) return;
  const mode = ps(p, "mode", "radial");
  const radial = mode === "radial";
  const angle = mode === "split" ? 0 : (pn(p, "angle", 0) * Math.PI) / 180;
  const N = Math.max(1, Math.round(pn(p, "samples", 1)));
  const sat = pn(p, "saturation", 1);
  const { ctx, img, d, W, H } = getData(canvas);
  const src = new Uint8ClampedArray(d);
  const cx = W / 2, cy = H / 2;
  const ax = Math.cos(angle), ay = Math.sin(angle);
  const sampleCh = (x: number, y: number, k: number) => {
    const xi = clamp(Math.round(x), 0, W - 1), yi = clamp(Math.round(y), 0, H - 1);
    return src[(yi * W + xi) * 4 + k] / 255;
  };
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
        const slide = (i / N) * 0.1;
        ar += sampleCh(x + bx * (amt + slide) * 1, y + by * (amt + slide) * 1, 0);
        ag += sampleCh(x + bx * (amt + slide) * 2, y + by * (amt + slide) * 2, 1);
        ab += sampleCh(x + bx * (amt + slide) * 3, y + by * (amt + slide) * 3, 2);
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
  // future: rygcbv 6-wavelength expansion (quality:high) for finer dispersion
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
  const radius = Math.max(0.5, pn(p, "radius", 12) * u);
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
function drawDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, shape: string, cell: number) {
  if (r <= 0.2) return;
  if (shape === "square") {
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  } else if (shape === "diamond") {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
  } else if (shape === "line") {
    ctx.fillRect(cx - cell / 2, cy - r / 2, cell, r);
  } else if (shape === "ring") {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, Math.max(0, r * 0.55), 0, Math.PI * 2, true);
    ctx.fill("evenodd");
  } else {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function halftoneScreen(
  canvas: HTMLCanvasElement,
  src: Uint8ClampedArray,
  cell: number,
  angleDeg: number,
  contrast: number,
  shape: string,
  channel: (x: number, y: number) => number, // 0..1 coverage at canvas px
  ink: string,
  stagger = false,
) {
  const W = canvas.width,
    H = canvas.height;
  const ctx = ctx2d(canvas);
  const ang = (angleDeg * Math.PI) / 180,
    cos = Math.cos(ang),
    sin = Math.sin(ang);
  ctx.save();
  ctx.fillStyle = ink;
  ctx.translate(W / 2, H / 2);
  ctx.rotate(ang);
  const diag = Math.ceil(Math.sqrt(W * W + H * H));
  let row = 0;
  for (let gy = -diag / 2; gy < diag / 2; gy += cell, row++) {
    const rowOffset = stagger && row % 2 === 1 ? cell / 2 : 0;
    for (let gx = -diag / 2; gx < diag / 2; gx += cell) {
      const cx = gx + rowOffset + cell / 2,
        cy = gy + cell / 2;
      const sx = cos * cx - sin * cy + W / 2,
        sy = sin * cx + cos * cy + H / 2;
      const cov = Math.pow(clamp(channel(sx, sy), 0, 1), contrast);
      // r = (cell/2)*sqrt(coverage) keeps dot AREA proportional to ink
      const r = Math.sqrt(cov) * (cell / 2) * 1.42;
      drawDot(ctx, cx, cy, r, shape, cell);
    }
  }
  ctx.restore();
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
  const shape = ps(p, "dotShape", "circle");
  const mode = ps(p, "mode", "mono");
  const stagger = pb(p, "stagger", false);
  const invertCells = pb(p, "invertCells", false);
  const W = canvas.width,
    H = canvas.height;
  const srcData = ctx2d(canvas).getImageData(0, 0, W, H).data;
  const at = (x: number, y: number) => {
    const xi = clamp(Math.round(x), 0, W - 1),
      yi = clamp(Math.round(y), 0, H - 1);
    return (yi * W + xi) * 4;
  };
  const ctx = ctx2d(canvas);

  if (mode === "cmyk") {
    // paper = white; overprint C/M/Y/K with multiply at classic screen angles
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    const chans: { ink: string; angle: number; cov: (i: number) => number }[] = [
      {
        ink: "#00aeef", angle: 15,
        cov: (i) => {
          const [c] = rgb2cmyk(
            srcData[i] / 255,
            srcData[i + 1] / 255,
            srcData[i + 2] / 255,
          );
          return invertCells ? 1 - c : c;
        },
      },
      {
        ink: "#ec008c", angle: 75,
        cov: (i) => {
          const [, m] = rgb2cmyk(
            srcData[i] / 255,
            srcData[i + 1] / 255,
            srcData[i + 2] / 255,
          );
          return invertCells ? 1 - m : m;
        },
      },
      {
        ink: "#fff200", angle: 0,
        cov: (i) => {
          const [, , y] = rgb2cmyk(
            srcData[i] / 255,
            srcData[i + 1] / 255,
            srcData[i + 2] / 255,
          );
          return invertCells ? 1 - y : y;
        },
      },
      {
        ink: "#1a1a1a", angle: 45,
        cov: (i) => {
          const [, , , k] = rgb2cmyk(
            srcData[i] / 255,
            srcData[i + 1] / 255,
            srcData[i + 2] / 255,
          );
          return invertCells ? 1 - k : k;
        },
      },
    ];
    for (const c of chans) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      halftoneScreen(canvas, srcData, cell, c.angle, contrast, shape, (x, y) => c.cov(at(x, y)), c.ink, stagger);
      ctx.restore();
    }
    return;
  }

  // mono: paper fill + ink dots sized by perceptual (sRGB) luminance, so mid-gray
  // maps to ~50% dot coverage. (Measuring in linear light over-inks mid-tones and
  // the whole screen reads too dark.)
  const ink = ps(p, "ink", "#191512");
  const paper = ps(p, "paper", "#f1ece4");
  ctx.save();
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  halftoneScreen(canvas, srcData, cell, angle, contrast, shape, (x, y) => {
    const i = at(x, y);
    const cov = 1 - luma601(srcData[i], srcData[i + 1], srcData[i + 2]) / 255;
    return invertCells ? 1 - cov : cov;
  }, ink, stagger);
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
  lineArt,
  kuwahara,
  // post parity
  crtCurvature,
  glitch,
  filmDust,
  characterBloom,
};
