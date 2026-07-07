// BG Lab — curated gallery, seed search tags, and the default config / presets.

import { nanoid } from "nanoid";
import { defaultParams, EFFECT_CATALOG } from "./catalog";
import type { BgConfig, Effect, EffectType, ParamValue } from "./types";

export interface GalleryImage {
  id: string;
  label: string;
  url: string;
}

const IMG_BASE = "/explorations/asset-bg/img";
const mk = (id: string, label: string, ext = "png"): GalleryImage => ({
  id,
  label,
  url: `${IMG_BASE}/${id}.${ext}`,
});

// Starters: a small curated set chosen to highlight effects across the range
// that matters — high-contrast landmark, tonal gradient, saturated detail,
// soft low-contrast, texture, organic scene. Uploads and Pexels are the
// primary sources; these exist so a first render is one click away.
export const GALLERY: GalleryImage[] = [
  mk("mon-haystack", "Haystack"),
  mk("mon-sunrise", "Sunrise"),
  mk("mon-poppies", "Poppies"),
  mk("photo-fog", "Fog"),
  mk("photo-dunes", "Dunes"),
  mk("atmo-charles", "Charles", "jpg"),
];

// Drafts and saved configs may reference gallery images that were removed in
// the starters cull — resolve them to the nearest surviving starter so an old
// draft never 404s its source.
const LEGACY_IMAGE_ALIASES: Record<string, string> = {
  "mon-lilies": "mon-poppies",
  "mon-clouds": "photo-fog",
  "mon-wisteria": "mon-poppies",
  "photo-ridges": "photo-dunes",
  "photo-water": "photo-fog",
  "photo-clouds": "photo-fog",
  "env-dawn": "mon-sunrise",
  "env-ridges": "photo-dunes",
  "env-water": "photo-fog",
  "env-clouds": "photo-fog",
  "env-dune": "photo-dunes",
  "atmo-dusk": "mon-sunrise",
  "atmo-foliage": "atmo-charles",
};

export function galleryUrl(id: string | null): string | null {
  if (!id) return null;
  const resolved = LEGACY_IMAGE_ALIASES[id] ?? id;
  const g = GALLERY.find((x) => x.id === resolved);
  return g ? g.url : null;
}

// Quick-search chips for Pexels (minimal / atmospheric aesthetic).
export const PEXELS_TAGS = [
  "minimal",
  "fog",
  "dune",
  "gradient sky",
  "grain texture",
  "monochrome landscape",
  "soft light",
  "mist",
  "horizon",
  "concrete",
];

export function makeEffect(type: EffectType): Effect {
  return { id: nanoid(8), type, enabled: true, params: defaultParams(type) };
}

export function makeDefaultConfig(): BgConfig {
  return {
    version: 1,
    output: { aspect: "3:2", longEdge: 2000 },
    source: { mode: "image", imageId: "mon-haystack", solidColor: "#cdd9e0" },
    stack: [makeEffect("pixelate"), makeEffect("grain")],
  };
}

export interface Preset {
  name: string;
  build: () => Effect[];
}

/** Tweak one effect's params inline while building a preset. */
function withParams(type: EffectType, params: Record<string, ParamValue>): Effect {
  const e = makeEffect(type);
  e.params = { ...e.params, ...params };
  return e;
}

// ---------------------------------------------------------------- Inspire Me
// Curated pools so a random look is coherent (a converter + a couple of mood
// posts + maybe a grade), never a random pile of 20 effects.
const STYLE_LOOKS: (() => Effect)[] = [
  () => withParams("ascii", { cell: 8, colorMode: "source", background: "original", charOpacity: 0.85 }),
  () => withParams("blockChars", { cell: 8, colorMode: "source", background: "original", charOpacity: 0.9 }),
  () => withParams("ascii", { cell: 10, colorMode: "ink", ink: "#e9e4d8", paper: "#14130f" }),
  () => withParams("glyphDots", { cell: 9, background: "original", charOpacity: 0.8 }),
  () => withParams("crosshatch", { cell: 9, background: "original", charOpacity: 0.8 }),
  () => withParams("mosaic", { size: 18, gap: 0.1 }),
  () => withParams("lego", { size: 22 }),
  () => withParams("halftone", { cell: 8, mode: "mono" }),
  () => withParams("dither", { type: "bayer4", levels: 3 }),
  () => withParams("diamond", { cell: 12, colorMode: "source", background: "original", charOpacity: 0.85 }),
];
const MOOD_POST: (() => Effect)[] = [
  () => withParams("grain", { amount: 0.14 }),
  () => withParams("vignette", { amount: 0.45 }),
  () => withParams("bloom", { intensity: 0.5, threshold: 0.65 }),
  () => withParams("scanlines", { spacing: 3, intensity: 0.25 }),
  () => withParams("chromatic", { amount: 4 }),
];
const GRADES: (() => Effect)[] = [
  () => withParams("gradientMap", { stops: [{ t: 0, color: "#1a1230" }, { t: 1, color: "#f3d9b8" }], amount: 0.7 }),
  () => withParams("adjust", { saturation: 1.25, contrast: 1.1 }),
  () => withParams("tint", { color: "#e8c9a8", opacity: 0.25, blend: "soft-light" }),
];

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** Jitter an effect's slider params ±12% of their range, clamped to the catalog. */
function jitterEffect(e: Effect): Effect {
  if (!e.type) return e;
  const params = { ...e.params };
  for (const c of EFFECT_CATALOG[e.type].controls) {
    if (c.kind === "slider" && typeof params[c.key] === "number") {
      const span = c.max - c.min;
      let v = (params[c.key] as number) + (Math.random() * 2 - 1) * 0.12 * span;
      v = Math.max(c.min, Math.min(c.max, v));
      if (c.step >= 1) v = Math.round(v / c.step) * c.step;
      params[c.key] = v;
    }
  }
  return { ...e, params };
}

/** A coherent ~3–4-effect random look on a random gallery source. */
export function inspire(): BgConfig {
  const stack: Effect[] = [jitterEffect(pick(STYLE_LOOKS)())];
  if (Math.random() < 0.5) stack.push(jitterEffect(pick(GRADES)())); // grade after the style
  const moodCount = 1 + Math.floor(Math.random() * 2); // 1–2 moods
  const moods = [...MOOD_POST].sort(() => Math.random() - 0.5).slice(0, moodCount);
  for (const m of moods) stack.push(jitterEffect(m()));
  const img = pick(GALLERY);
  return {
    version: 1,
    output: { aspect: "3:2", longEdge: 2000 },
    source: { mode: "image", imageId: img.id, solidColor: "#cdd9e0" },
    stack,
  };
}

// Curated looks distilled from the effect explorations. Applying a preset
// replaces the current stack (source + output are kept).
export const PRESETS: Preset[] = [
  {
    name: "Pixel + grain",
    build: () => [withParams("pixelate", { size: 14 }), withParams("grain", { amount: 0.18 })],
  },
  {
    name: "Newsprint",
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 8, mode: "mono", aa: true })],
  },
  {
    name: "CMYK print",
    build: () => [withParams("halftone", { cell: 9, mode: "cmyk", aa: true })],
  },
  {
    name: "Floyd dither",
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 2, mono: true })],
  },
  {
    name: "Blue noise",
    build: () => [withParams("dither", { type: "blueNoise", levels: 2, mono: true })],
  },
  {
    name: "Risograph",
    build: () => [
      withParams("posterize", { levels: 4 }),
      makeEffect("gradientMap"),
      withParams("grain", { amount: 0.22, blend: "multiply" }),
    ],
  },
  {
    name: "Sepia film",
    build: () => [makeEffect("gradientMap"), withParams("grain", { amount: 0.16 }), withParams("vignette", { amount: 0.5 })],
  },
  {
    name: "Duotone",
    build: () => [
      withParams("gradientMap", {
        stops: [
          { t: 0, color: "#10243a" },
          { t: 1, color: "#f2d8b8" },
        ],
      }),
    ],
  },
  {
    name: "Chromatic",
    build: () => [withParams("chromatic", { amount: 8 }), withParams("grain", { amount: 0.12 })],
  },
  {
    name: "CRT",
    build: () => [
      withParams("scanlines", { spacing: 3, intensity: 0.4 }),
      withParams("chromatic", { amount: 3 }),
      withParams("vignette", { amount: 0.5 }),
    ],
  },
  {
    name: "Bloom",
    build: () => [withParams("adjust", { contrast: 1.15, saturation: 1.2 }), withParams("bloom", { intensity: 0.8, threshold: 0.6 })],
  },
  {
    name: "Warp",
    build: () => [withParams("displace", { amount: 24, scale: 4 }), makeEffect("grayscale")],
  },
  {
    name: "Threshold ink",
    build: () => [withParams("threshold", { level: 0.5 }), withParams("grain", { amount: 0.1 })],
  },
  // --- More looks ported from the effect explorations ---
  {
    name: "Pixel dots",
    build: () => [withParams("pixelate", { size: 22, shape: "circle" }), withParams("grain", { amount: 0.12 })],
  },
  {
    name: "Pixel diamonds",
    build: () => [withParams("pixelate", { size: 24, shape: "diamond" })],
  },
  {
    name: "Halftone rings",
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 12, mode: "mono", dotShape: "ring" })],
  },
  {
    name: "Bayer dither",
    build: () => [withParams("dither", { type: "bayer4", levels: 2, mono: true })],
  },
  {
    name: "Coarse Bayer",
    build: () => [withParams("dither", { type: "bayer8", levels: 2, scale: 3, mono: true })],
  },
  {
    name: "Floyd colour",
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 3, mono: false })],
  },
  {
    name: "Sine warp",
    build: () => [withParams("displace", { amount: 30, scale: 4, type: "sine" })],
  },
  {
    name: "Scanlines RGB",
    build: () => [withParams("scanlines", { spacing: 6, intensity: 0.6, rgbCells: true })],
  },
  {
    name: "Poster pop",
    build: () => [withParams("posterize", { levels: 5, perChannel: true }), withParams("adjust", { saturation: 1.4, contrast: 1.1 })],
  },
  {
    name: "Colour wash",
    build: () => [withParams("tint", { color: "#e8c9a8", opacity: 0.45, blend: "multiply" }), withParams("grain", { amount: 0.1 })],
  },
  {
    name: "Soft focus",
    build: () => [withParams("blur", { radius: 10 }), withParams("bloom", { intensity: 0.6, threshold: 0.65 })],
  },
  {
    name: "Vignette fade",
    build: () => [withParams("adjust", { contrast: 1.1 }), withParams("vignette", { amount: 0.8, radius: 0.7 })],
  },
  {
    name: "Heavy grain",
    build: () => [makeEffect("grayscale"), withParams("grain", { amount: 0.5, mono: true })],
  },
  // --- one-click colour grades ---
  {
    name: "Grade · B&W",
    build: () => [makeEffect("grayscale"), withParams("adjust", { contrast: 1.15 })],
  },
  {
    name: "Grade · Sepia",
    build: () => [
      makeEffect("grayscale"),
      withParams("gradientMap", { stops: [{ t: 0, color: "#241a12" }, { t: 1, color: "#f2e3cb" }], amount: 0.85 }),
    ],
  },
  {
    name: "Grade · Warm",
    build: () => [withParams("adjust", { temperature: 0.3, saturation: 1.1 })],
  },
  {
    name: "Grade · Cool",
    build: () => [withParams("adjust", { temperature: -0.3, saturation: 1.05 })],
  },
  {
    name: "Grade · Vintage",
    build: () => [
      withParams("adjust", { contrast: 0.9, saturation: 0.8 }),
      withParams("tint", { color: "#e8c9a8", opacity: 0.2, blend: "soft-light" }),
      withParams("vignette", { amount: 0.4 }),
      withParams("grain", { amount: 0.1 }),
    ],
  },
  {
    name: "Grade · Fade",
    build: () => [withParams("adjust", { contrast: 0.8, gamma: 1.25 })],
  },
  {
    name: "Grade · Cyber",
    build: () => [
      withParams("gradientMap", { stops: [{ t: 0, color: "#06122a" }, { t: 0.5, color: "#1ea7b6" }, { t: 1, color: "#f06" }], amount: 0.6 }),
      withParams("chromatic", { amount: 4 }),
    ],
  },
  // --- converter / style looks (ascii-magic parity) ---
  {
    name: "ASCII art",
    build: () => [withParams("ascii", { cell: 10, ink: "#e9e4d8", paper: "#16140f" }), withParams("grain", { amount: 0.08 })],
  },
  {
    name: "ASCII colour",
    build: () => [withParams("ascii", { cell: 9, colorMode: "source", paper: "#0a0a0a" })],
  },
  {
    name: "Block print",
    build: () => [withParams("blockChars", { cell: 9, colorMode: "source" })],
  },
  {
    name: "Crosshatch",
    build: () => [makeEffect("grayscale"), withParams("crosshatch", { cell: 9 })],
  },
  {
    name: "Diamonds",
    build: () => [withParams("diamond", { cell: 12, colorMode: "source", paper: "#101010" })],
  },
  {
    name: "Rain lines",
    build: () => [withParams("lines", { cell: 7 })],
  },
  {
    name: "Halftone dots",
    build: () => [makeEffect("grayscale"), withParams("glyphDots", { cell: 9, ink: "#111111", paper: "#f3efe6" })],
  },
  {
    name: "Mosaic tiles",
    build: () => [withParams("mosaic", { size: 22, gap: 0.12 })],
  },
  {
    name: "LEGO",
    build: () => [withParams("lego", { size: 24 })],
  },
  {
    name: "VHS glitch",
    build: () => [
      withParams("chromatic", { amount: 4, mode: "split" }),
      withParams("glitch", { amount: 0.45 }),
      withParams("scanlines", { spacing: 3, intensity: 0.3 }),
      withParams("filmDust", { amount: 0.25 }),
    ],
  },
  {
    name: "CRT curve",
    build: () => [
      withParams("scanlines", { spacing: 3, intensity: 0.35 }),
      withParams("crtCurvature", { amount: 0.3, edge: 0.4 }),
      withParams("vignette", { amount: 0.5 }),
    ],
  },
  {
    name: "ASCII glow",
    build: () => [
      withParams("ascii", { cell: 9, ink: "#9affc0", paper: "#04120a" }),
      withParams("characterBloom", { intensity: 0.8, threshold: 0.4 }),
    ],
  },
];
