// BG Lab — shared CPU helpers (math, canvas temps, dither matrices).

import type { GradientStop, ParamValue } from "../../types";

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function hexRGB(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
}

export const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// Rec.601 (matches the prototype's grayscale/duotone weighting)
export const luma601 = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

// --- linear-light helpers (canvas pixels are 8-bit sRGB) ---
// Cheap sRGB↔linear (pow 2.2). Use for gamma-correct coverage/averaging in ops
// that resample (halftone coverage, dither quantize) so mid-tones aren't crushed.
export const srgbToLin = (c: number) => Math.pow(c / 255, 2.2);
export const linToSrgb = (l: number) => Math.pow(Math.max(0, l), 1 / 2.2) * 255;
/** Rec.601 luminance computed in linear light, returned 0..1. */
export const linLuma601 = (r: number, g: number, b: number) =>
  0.299 * srgbToLin(r) + 0.587 * srgbToLin(g) + 0.114 * srgbToLin(b);

// --- param readers (params are loosely typed Record<string, ParamValue>) ---
export const pn = (p: Record<string, ParamValue>, k: string, d = 0): number =>
  typeof p[k] === "number" ? (p[k] as number) : d;
export const ps = (p: Record<string, ParamValue>, k: string, d = ""): string =>
  typeof p[k] === "string" ? (p[k] as string) : d;
export const pb = (p: Record<string, ParamValue>, k: string, d = false): boolean =>
  typeof p[k] === "boolean" ? (p[k] as boolean) : d;
export const pstops = (p: Record<string, ParamValue>, k: string): GradientStop[] =>
  Array.isArray(p[k]) ? (p[k] as GradientStop[]) : [];

// --- canvas temps (use the target's ownerDocument so it works in any DOM) ---
export function tmpCanvas(ref: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const doc = ref.ownerDocument || document;
  const c = doc.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
export const ctx2d = (c: HTMLCanvasElement) =>
  c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;

/** snapshot canvas, clear it, and let `redraw` repaint (used to apply ctx.filter in place) */
export function recompose(canvas: HTMLCanvasElement, redraw: (ctx: CanvasRenderingContext2D, snap: HTMLCanvasElement) => void) {
  const W = canvas.width,
    H = canvas.height;
  const snap = tmpCanvas(canvas, W, H);
  ctx2d(snap).drawImage(canvas, 0, 0);
  const ctx = ctx2d(canvas);
  ctx.clearRect(0, 0, W, H);
  redraw(ctx, snap);
}

// --- ordered-dither matrices (normalized 0..1) ---
const B2 = [0, 2, 3, 1];
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// prettier-ignore
const B8 = [
  0,32,8,40,2,34,10,42, 48,16,56,24,50,18,58,26,
  12,44,4,36,14,46,6,38, 60,28,52,20,62,30,54,22,
  3,35,11,43,1,33,9,41, 51,19,59,27,49,17,57,25,
  15,47,7,39,13,45,5,37, 63,31,55,23,61,29,53,21,
];

// Stylized 8x8 matrices (Heckel §C4 / source §F C4) — compared to luma for artistic dithering.
// prettier-ignore
const STRIPE8 = [
   0, 8,16,24,32,40,48,56,
   4,12,20,28,36,44,52,60,
   8,16,24,32,40,48,56, 0,
  12,20,28,36,44,52,60, 4,
  16,24,32,40,48,56, 0, 8,
  20,28,36,44,52,60, 4,12,
  24,32,40,48,56, 0, 8,16,
  28,36,44,52,60, 4,12,20,
];
// prettier-ignore
const CROSS_STRIPE8 = [
   0,12,24,36,48,60, 8,20,
  16,28,40,52, 4,56,32,44,
   8,20, 0,12,24,36,48,60,
  40,52,16,28, 4,56,32,44,
  48,60, 8,20, 0,12,24,36,
  32,44,40,52,16,28, 4,56,
  24,36,48,60, 8,20, 0,12,
  56, 4,32,44,40,52,16,28,
];

export function orderedThreshold(type: string, x: number, y: number): number {
  if (type === "bayer2") return (B2[(y & 1) * 2 + (x & 1)] + 0.5) / 4;
  if (type === "bayer8") return (B8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
  if (type === "stripes") return (STRIPE8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
  if (type === "crossStripe") return (CROSS_STRIPE8[(y & 7) * 8 + (x & 7)] + 0.5) / 64;
  if (type === "blueNoise") {
    // Interleaved Gradient Noise (Jimenez) — a cheap blue-noise-like threshold
    return (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
  }
  return (B4[(y & 3) * 4 + (x & 3)] + 0.5) / 16; // bayer4 default
}
