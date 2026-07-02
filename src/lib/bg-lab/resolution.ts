// BG Lab — resolution math. The same render runs at preview dims and export dims;
// every size-bearing param is multiplied by unit = W/1000 so the look is
// proportional and export matches preview.

import type { AspectId, Dims, OutputState } from "./types";

export const ASPECTS: { id: AspectId; label: string; ratio: number }[] = [
  { id: "3:2", label: "3:2 landscape", ratio: 3 / 2 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "21:9", label: "21:9 ultrawide", ratio: 21 / 9 },
  { id: "1:1", label: "1:1 square", ratio: 1 },
  { id: "2:3", label: "2:3 portrait", ratio: 2 / 3 },
  { id: "9:16", label: "9:16 portrait", ratio: 9 / 16 },
];

export const MAX_EXPORT_PIXELS = 40_000_000; // ~40 MP guard
export const PREVIEW_MAX_LONG = 1100; // cap preview long-edge for live perf

export function unit(W: number): number {
  return W / 1000;
}

export function aspectRatio(aspect: OutputState["aspect"]): number {
  if (typeof aspect === "string") {
    const found = ASPECTS.find((a) => a.id === aspect);
    return found ? found.ratio : 3 / 2;
  }
  const w = aspect.w || 1;
  const h = aspect.h || 1;
  return Math.max(0.05, w / h);
}

/** export dims from aspect + long-edge */
export function outputDims(aspect: OutputState["aspect"], longEdge: number): Dims {
  const a = aspectRatio(aspect);
  const L = Math.max(16, Math.round(longEdge));
  return a >= 1
    ? { W: L, H: Math.round(L / a) }
    : { W: Math.round(L * a), H: L };
}

/** preview dims fit inside a container box, capped + dpr-aware */
export function previewDims(
  aspect: OutputState["aspect"],
  box: { w: number; h: number },
  dpr = 1,
): Dims {
  const a = aspectRatio(aspect);
  let cssW = box.w;
  let cssH = cssW / a;
  if (cssH > box.h) {
    cssH = box.h;
    cssW = cssH * a;
  }
  // render resolution = css size × dpr, capped to PREVIEW_MAX_LONG on the long edge
  let W = Math.round(cssW * dpr);
  let H = Math.round(cssH * dpr);
  const long = Math.max(W, H);
  if (long > PREVIEW_MAX_LONG) {
    const k = PREVIEW_MAX_LONG / long;
    W = Math.round(W * k);
    H = Math.round(H * k);
  }
  return { W: Math.max(1, W), H: Math.max(1, H) };
}

export function totalPixels(dims: Dims): number {
  return dims.W * dims.H;
}
