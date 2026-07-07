// BG Lab — GL pass registry. The shared plumbing (types, HEADER/f/loc/col,
// COPY_FRAG) lives in ./common; each pass family lives in ./passes/*. This
// file only re-exports the plumbing and assembles GL_OPS — the entries and
// their order are unchanged from the pre-split file.

import type { EffectType } from "../../types";
import type { GpuPass } from "./common";
import { bloom, blur, characterBloom } from "./passes/blur-bloom";
import { adjust, gradientMap, grayscale, posterize, threshold, tint } from "./passes/color";
import { crochet, flutedGlass, ledPanel, receipt } from "./passes/creative";
import { dither } from "./passes/dither";
import { glyphs } from "./passes/glyphs";
import { halftone } from "./passes/halftone";
import { lineArt } from "./passes/lineart";
import { kuwahara } from "./passes/painterly";
import { chromatic, crtCurvature, displace, grain, lightRays, pixelate, scanlines, sharpen, vignette } from "./passes/post";

export * from "./common";

export const GL_OPS: Partial<Record<EffectType, GpuPass>> = {
  grayscale,
  threshold,
  posterize,
  tint,
  scanlines,
  vignette,
  adjust,
  chromatic,
  displace,
  sharpen,
  pixelate,
  dither,
  halftone,
  receipt,
  flutedGlass,
  ledPanel,
  crochet,
  crtCurvature,
  gradientMap,
  grain,
  kuwahara,
  lineArt,
  blur,
  bloom,
  lightRays,
  characterBloom,
  ascii: glyphs,
  blockChars: glyphs,
  crosshatch: glyphs,
  diagonal: glyphs,
  diamond: glyphs,
  lines: glyphs,
  mixed: glyphs,
  glyphDots: glyphs,
};
