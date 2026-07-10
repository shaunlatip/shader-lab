// BG Lab — OKLCH color + perceptual ramp baking. Every Editions palette is
// perceptual-lightness (OKLCH), so gradient stops interpolate here in OKLab/LCh
// rather than sRGB — no dead-gray midpoints, no muddy hue swings. Inline
// (Ottosson's matrices) to avoid a color dependency; ~1 KB.
//
// Public surface is intentionally small: `bakeRampOklch` turns a list of
// { t, #rrggbb } stops into N evenly-spaced #rrggbb stops interpolated in OKLCH,
// which the native Canvas2D gradient geometry then carries. That's how a linear/
// radial/conic gradient gets perceptual interpolation for free on BOTH engines
// (the base source composites on a 2D canvas in each — see cpuEngine/glEngine).

import type { GradientStop } from "../../types";

// ---- sRGB companding ----
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

export interface Oklch {
  /** perceptual lightness 0..1 */
  l: number;
  /** chroma, ~0..0.4 in sRGB gamut */
  c: number;
  /** hue degrees 0..360 */
  h: number;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const toHex2 = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0");

export function hexToOklch(hex: string): Oklch {
  const [r8, g8, b8] = parseHex(hex);
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);

  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const c = Math.hypot(a, bb);
  let h = (Math.atan2(bb, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

export function oklchToHex({ l: L, c, h }: Oklch): string {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const bb = c * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * bb;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * bb;
  const s_ = L - 0.0894841775 * a - 1.291485548 * bb;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r = linearToSrgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
  const g = linearToSrgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
  const b = linearToSrgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3);

  // simple gamut clip to sRGB — adequate for background ramps.
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

/** OKLab {L,a,b} for a hex color — a/b blend linearly (no hue wraparound), so
 * this is the right space for multi-point mesh blends. */
export function hexToOklab(hex: string): { L: number; a: number; b: number } {
  const { l, c, h } = hexToOklch(hex);
  const hr = (h * Math.PI) / 180;
  return { L: l, a: c * Math.cos(hr), b: c * Math.sin(hr) };
}

/** OKLab {L,a,b} → #rrggbb (via the OKLCH path). */
export function oklabToHex(L: number, a: number, b: number): string {
  const c = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return oklchToHex({ l: L, c, h });
}

/** Interpolate two OKLCH colors. Hue takes the shortest angular path; an
 * achromatic endpoint (c≈0) borrows the other's hue so ramps to/from gray/white
 * don't swing through an arbitrary hue. */
function mixOklch(a: Oklch, b: Oklch, t: number): Oklch {
  const aAchroma = a.c < 1e-4;
  const bAchroma = b.c < 1e-4;
  const ha = aAchroma ? b.h : a.h;
  const hb = bAchroma ? a.h : b.h;
  let dh = hb - ha;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return {
    l: a.l + (b.l - a.l) * t,
    c: a.c + (b.c - a.c) * t,
    h: ha + dh * t,
  };
}

/** Turn N GradientStops into `samples` evenly-spaced #rrggbb stops interpolated
 * in OKLCH. Feed the result to createLinear/Radial/ConicGradient so native
 * gradient geometry carries perceptual interpolation. Deterministic — no RNG. */
export function bakeRampOklch(stops: GradientStop[], samples = 48): { t: number; color: string }[] {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return [{ t: 0, color: "#000000" }, { t: 1, color: "#000000" }];
  if (sorted.length === 1) return [{ t: 0, color: sorted[0].color }, { t: 1, color: sorted[0].color }];

  const lch = sorted.map((s) => hexToOklch(s.color));
  const out: { t: number; color: string }[] = [];
  const n = Math.max(2, samples);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // locate the segment [sorted[j], sorted[j+1]] containing t
    let j = 0;
    while (j < sorted.length - 2 && t > sorted[j + 1].t) j++;
    const t0 = sorted[j].t;
    const t1 = sorted[j + 1].t;
    const span = t1 - t0;
    const local = span <= 1e-6 ? 0 : clamp01((t - t0) / span);
    out.push({ t, color: oklchToHex(mixOklch(lch[j], lch[j + 1], local)) });
  }
  return out;
}
