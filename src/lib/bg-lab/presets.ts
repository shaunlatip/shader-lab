// BG Lab — curated gallery, seed search tags, and the default config / presets.

import { nanoid } from "nanoid";
import { defaultParams, EFFECT_CATALOG } from "./catalog";
import type { BgConfig, Effect, EffectType, ParamValue, SourceState } from "./types";

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

export type PresetCategory = "Print" | "Text" | "Paint" | "Film" | "Grade" | "Glitch" | "Scene";

export interface Preset {
  /** Stable key — names the pre-rendered thumbnail at /presets/<slug>.webp. */
  slug: string;
  name: string;
  category: PresetCategory;
  /** Heroes appear as thumbnail cards in the gallery; the rest live behind
   * the all-presets search. */
  curated?: boolean;
  /** Optional source the preset carries (generative-source looks — clouds,
   * caustics, sky). Merged into the current source on apply; presets without
   * it keep the user's source, as before. */
  source?: Partial<SourceState>;
  build: () => Effect[];
}

/** Tweak one effect's params inline while building a preset. */
function withParams(type: EffectType, params: Record<string, ParamValue>): Effect {
  const e = makeEffect(type);
  e.params = { ...e.params, ...params };
  return e;
}

// ------------------------------------------------------------------ Randomize
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
  () => withParams("halftone", { cell: 12, gooey: 0.75, overflow: 0.3 }),
  () => withParams("dither", { type: "bayer4", levels: 3 }),
  () => withParams("dither", { type: "blueNoise", levels: 2, mono: true }),
  () => withParams("diamond", { cell: 12, colorMode: "source", background: "original", charOpacity: 0.85 }),
  () => withParams("kuwahara", { quality: "smooth", radius: 6 }),
  () => withParams("lineArt", { mode: "outline", thickness: 1.8, threshold: 0.35 }),
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

/** The coherent ~3–4-effect random stack shared by both inspire flavours. */
export function inspireStack(): Effect[] {
  const stack: Effect[] = [jitterEffect(pick(STYLE_LOOKS)())];
  if (Math.random() < 0.5) stack.push(jitterEffect(pick(GRADES)())); // grade after the style
  const moodCount = 1 + Math.floor(Math.random() * 2); // 1–2 moods
  const moods = [...MOOD_POST].sort(() => Math.random() - 0.5).slice(0, moodCount);
  for (const m of moods) stack.push(jitterEffect(m()));
  return stack;
}

/** A coherent random look on a random gallery source (sync fallback). */
export function inspire(): BgConfig {
  const img = pick(GALLERY);
  return {
    version: 1,
    output: { aspect: "3:2", longEdge: 2000 },
    source: { mode: "image", imageId: img.id, solidColor: "#cdd9e0" },
    stack: inspireStack(),
  };
}

/** A random Pexels photo (or video) url as an imageId. Random tag + page
 * through /api/pexels, random pick from the results. Returns null when the
 * key is missing (route returns 501), the fetch fails, or a page comes back
 * empty — callers fall back to the gallery so the button always works. */
export async function randomPexelsId(kind: "photo" | "video" = "photo"): Promise<string | null> {
  try {
    const tag = pick([...PEXELS_TAGS]);
    const page = 1 + Math.floor(Math.random() * 3);
    const r = await fetch(`/api/pexels?q=${encodeURIComponent(tag)}&page=${page}&type=${kind}`);
    if (!r.ok) return null;
    const data = (await r.json()) as { results?: { full: string }[] };
    const results = data.results ?? [];
    if (results.length === 0) return null;
    const item = pick(results);
    return kind === "video" ? `pexels:video:${item.full}` : `pexels:${item.full}`;
  } catch {
    return null;
  }
}

/** Inspire from a random Pexels photo, falling back to the gallery — the
 * button must always produce a look. */
export async function inspireFromPexels(): Promise<BgConfig> {
  const id = await randomPexelsId("photo");
  if (!id) return inspire();
  return {
    version: 1,
    output: { aspect: "3:2", longEdge: 2000 },
    source: { mode: "image", imageId: id, solidColor: "#cdd9e0" },
    stack: inspireStack(),
  };
}

// The preset library. Curated heroes render as thumbnail cards in the
// gallery (grouped by category); the rest are reachable through the
// all-presets search. Applying a preset replaces the current stack
// (source + output are kept, unless the preset carries a `source`).
// Slugs are stable — they name the pre-rendered thumbnails in /public/presets/.
export const PRESETS: Preset[] = [
  // ---------------------------------------------------------------- Print
  {
    slug: "newsprint",
    name: "Newsprint",
    category: "Print",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 8, mode: "mono", aa: true })],
  },
  {
    slug: "cmyk-print",
    name: "CMYK print",
    category: "Print",
    curated: true,
    build: () => [withParams("halftone", { cell: 9, mode: "cmyk", aa: true })],
  },
  {
    slug: "risograph",
    name: "Risograph",
    category: "Print",
    curated: true,
    build: () => [
      withParams("posterize", { levels: 4 }),
      makeEffect("gradientMap"),
      withParams("grain", { amount: 0.22, blend: "multiply" }),
    ],
  },
  {
    slug: "floyd-dither",
    name: "Floyd dither",
    category: "Print",
    curated: true,
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 2, mono: true })],
  },
  {
    slug: "crosshatch",
    name: "Crosshatch",
    category: "Print",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("crosshatch", { cell: 9 })],
  },
  {
    slug: "halftone-dots",
    name: "Halftone dots",
    category: "Print",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("glyphDots", { cell: 9, ink: "#111111", paper: "#f3efe6" })],
  },
  {
    slug: "gooey-halftone",
    name: "Gooey halftone",
    category: "Print",
    build: () => [withParams("halftone", { cell: 12, gooey: 0.75, overflow: 0.3 })],
  },
  {
    slug: "blue-noise",
    name: "Blue noise",
    category: "Print",
    build: () => [withParams("dither", { type: "blueNoise", levels: 2, mono: true })],
  },
  {
    slug: "bayer-dither",
    name: "Bayer dither",
    category: "Print",
    build: () => [withParams("dither", { type: "bayer4", levels: 2, mono: true })],
  },
  {
    slug: "coarse-bayer",
    name: "Coarse Bayer",
    category: "Print",
    build: () => [withParams("dither", { type: "bayer8", levels: 2, scale: 3, mono: true })],
  },
  {
    slug: "floyd-colour",
    name: "Floyd colour",
    category: "Print",
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 3, mono: false })],
  },
  {
    slug: "halftone-rings",
    name: "Halftone rings",
    category: "Print",
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 12, mode: "mono", dotShape: "ring" })],
  },
  {
    slug: "threshold-ink",
    name: "Threshold ink",
    category: "Print",
    build: () => [withParams("threshold", { level: 0.5 }), withParams("grain", { amount: 0.1 })],
  },
  {
    slug: "engraving",
    name: "Engraving",
    category: "Print",
    build: () => [makeEffect("grayscale"), withParams("diagonal", { cell: 9 })],
  },

  // ---------------------------------------------------------------- Text
  {
    slug: "ascii-art",
    name: "ASCII art",
    category: "Text",
    curated: true,
    build: () => [withParams("ascii", { cell: 10, ink: "#e9e4d8", paper: "#16140f" }), withParams("grain", { amount: 0.08 })],
  },
  {
    slug: "block-print",
    name: "Block print",
    category: "Text",
    curated: true,
    build: () => [withParams("blockChars", { cell: 9, colorMode: "source" })],
  },
  {
    slug: "ascii-colour",
    name: "ASCII colour",
    category: "Text",
    build: () => [withParams("ascii", { cell: 9, colorMode: "source", paper: "#0a0a0a" })],
  },
  {
    slug: "ascii-glow",
    name: "ASCII glow",
    category: "Text",
    build: () => [
      withParams("ascii", { cell: 9, ink: "#9affc0", paper: "#04120a" }),
      withParams("characterBloom", { intensity: 0.8, threshold: 0.4 }),
    ],
  },
  {
    slug: "diamonds",
    name: "Diamonds",
    category: "Text",
    build: () => [withParams("diamond", { cell: 12, colorMode: "source", paper: "#101010" })],
  },
  {
    slug: "rain-lines",
    name: "Rain lines",
    category: "Text",
    build: () => [withParams("lines", { cell: 7 })],
  },

  // ---------------------------------------------------------------- Paint
  {
    slug: "oil-paint",
    name: "Oil paint",
    category: "Paint",
    curated: true,
    build: () => [withParams("kuwahara", { quality: "smooth", radius: 6 }), withParams("adjust", { saturation: 1.15, contrast: 1.05 })],
  },
  {
    slug: "ink-sketch",
    name: "Ink sketch",
    category: "Paint",
    curated: true,
    build: () => [withParams("lineArt", { mode: "outline", thickness: 1.8, threshold: 0.35 }), withParams("grain", { amount: 0.06 })],
  },
  {
    slug: "brushwork",
    name: "Brushwork",
    category: "Paint",
    build: () => [
      withParams("kuwahara", { quality: "anisotropic", radius: 7, anisotropy: 1.6 }),
      withParams("adjust", { saturation: 1.15 }),
      withParams("grain", { amount: 0.06 }),
    ],
  },

  // ---------------------------------------------------------------- Film
  {
    slug: "sepia-film",
    name: "Sepia film",
    category: "Film",
    curated: true,
    build: () => [makeEffect("gradientMap"), withParams("grain", { amount: 0.16 }), withParams("vignette", { amount: 0.5 })],
  },
  {
    slug: "heavy-grain",
    name: "Heavy grain",
    category: "Film",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("grain", { amount: 0.5, mono: true })],
  },
  {
    slug: "golden-hour",
    name: "Golden hour",
    category: "Film",
    curated: true,
    build: () => [
      withParams("lightRays", { y: 22, threshold: 0.55, strength: 0.9, color: "#ffcf9a" }),
      withParams("tint", { color: "#e8a86a", opacity: 0.2, blend: "soft-light" }),
      withParams("vignette", { amount: 0.35 }),
    ],
  },
  {
    slug: "god-rays",
    name: "God rays",
    category: "Film",
    curated: true,
    build: () => [
      withParams("adjust", { contrast: 1.1 }),
      withParams("lightRays", { samples: 48, density: 0.95, decay: 0.94, strength: 1.1 }),
      withParams("grain", { amount: 0.08 }),
    ],
  },
  {
    slug: "soft-focus",
    name: "Soft focus",
    category: "Film",
    build: () => [withParams("blur", { radius: 10 }), withParams("bloom", { intensity: 0.6, threshold: 0.65 })],
  },
  {
    slug: "bloom",
    name: "Bloom",
    category: "Film",
    build: () => [withParams("adjust", { contrast: 1.15, saturation: 1.2 }), withParams("bloom", { intensity: 0.8, threshold: 0.6 })],
  },

  // ---------------------------------------------------------------- Grade
  {
    slug: "duotone",
    name: "Duotone",
    category: "Grade",
    curated: true,
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
    slug: "grade-bw",
    name: "Black & white",
    category: "Grade",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("adjust", { contrast: 1.15 })],
  },
  {
    slug: "grade-sepia",
    name: "Grade · Sepia",
    category: "Grade",
    build: () => [
      makeEffect("grayscale"),
      withParams("gradientMap", { stops: [{ t: 0, color: "#241a12" }, { t: 1, color: "#f2e3cb" }], amount: 0.85 }),
    ],
  },
  {
    slug: "grade-warm",
    name: "Grade · Warm",
    category: "Grade",
    build: () => [withParams("adjust", { temperature: 0.3, saturation: 1.1 })],
  },
  {
    slug: "grade-cool",
    name: "Grade · Cool",
    category: "Grade",
    build: () => [withParams("adjust", { temperature: -0.3, saturation: 1.05 })],
  },
  {
    slug: "grade-fade",
    name: "Grade · Fade",
    category: "Grade",
    build: () => [withParams("adjust", { contrast: 0.8, gamma: 1.25 })],
  },
  {
    slug: "grade-vintage",
    name: "Grade · Vintage",
    category: "Grade",
    build: () => [
      withParams("adjust", { contrast: 0.9, saturation: 0.8 }),
      withParams("tint", { color: "#e8c9a8", opacity: 0.2, blend: "soft-light" }),
      withParams("vignette", { amount: 0.4 }),
      withParams("grain", { amount: 0.1 }),
    ],
  },
  {
    slug: "grade-cyber",
    name: "Grade · Cyber",
    category: "Grade",
    build: () => [
      withParams("gradientMap", { stops: [{ t: 0, color: "#06122a" }, { t: 0.5, color: "#1ea7b6" }, { t: 1, color: "#f06" }], amount: 0.6 }),
      withParams("chromatic", { amount: 4 }),
    ],
  },
  {
    slug: "colour-wash",
    name: "Colour wash",
    category: "Grade",
    build: () => [withParams("tint", { color: "#e8c9a8", opacity: 0.45, blend: "multiply" }), withParams("grain", { amount: 0.1 })],
  },
  {
    slug: "vignette-fade",
    name: "Vignette fade",
    category: "Grade",
    build: () => [withParams("adjust", { contrast: 1.1 }), withParams("vignette", { amount: 0.8, radius: 0.7 })],
  },
  {
    slug: "poster-pop",
    name: "Poster pop",
    category: "Grade",
    build: () => [withParams("posterize", { levels: 5, perChannel: true }), withParams("adjust", { saturation: 1.4, contrast: 1.1 })],
  },

  // ---------------------------------------------------------------- Glitch
  {
    slug: "vhs-glitch",
    name: "VHS glitch",
    category: "Glitch",
    curated: true,
    build: () => [
      withParams("chromatic", { amount: 4, mode: "split" }),
      withParams("glitch", { amount: 0.45 }),
      withParams("scanlines", { spacing: 3, intensity: 0.3 }),
      withParams("filmDust", { amount: 0.25 }),
    ],
  },
  {
    slug: "crt-curve",
    name: "CRT curve",
    category: "Glitch",
    curated: true,
    build: () => [
      withParams("scanlines", { spacing: 3, intensity: 0.35 }),
      withParams("crtCurvature", { amount: 0.3, edge: 0.4 }),
      withParams("vignette", { amount: 0.5 }),
    ],
  },
  {
    slug: "chromatic",
    name: "Chromatic",
    category: "Glitch",
    build: () => [withParams("chromatic", { amount: 8 }), withParams("grain", { amount: 0.12 })],
  },
  {
    slug: "dispersion",
    name: "Dispersion",
    category: "Glitch",
    build: () => [withParams("chromatic", { amount: 8, samples: 8, quality: "high" }), withParams("grain", { amount: 0.08 })],
  },
  {
    slug: "vaporwave",
    name: "Vaporwave",
    category: "Glitch",
    build: () => [
      withParams("chromatic", { amount: 6, mode: "split" }),
      withParams("scanlines", { spacing: 4, intensity: 0.3 }),
      withParams("gradientMap", {
        stops: [
          { t: 0, color: "#2b0a4e" },
          { t: 0.5, color: "#e83fb8" },
          { t: 1, color: "#7df9ff" },
        ],
        amount: 0.75,
      }),
      withParams("grain", { amount: 0.12 }),
    ],
  },
  {
    slug: "scanlines-rgb",
    name: "Scanlines RGB",
    category: "Glitch",
    build: () => [withParams("scanlines", { spacing: 6, intensity: 0.6, rgbCells: true })],
  },
  {
    slug: "sine-warp",
    name: "Sine warp",
    category: "Glitch",
    build: () => [withParams("displace", { amount: 30, scale: 4, type: "sine" })],
  },
  {
    slug: "warp",
    name: "Warp",
    category: "Glitch",
    build: () => [withParams("displace", { amount: 24, scale: 4 }), makeEffect("grayscale")],
  },
  {
    slug: "pixel-grain",
    name: "Pixel + grain",
    category: "Glitch",
    build: () => [withParams("pixelate", { size: 14 }), withParams("grain", { amount: 0.18 })],
  },
  {
    slug: "pixel-dots",
    name: "Pixel dots",
    category: "Glitch",
    build: () => [withParams("pixelate", { size: 22, shape: "circle" }), withParams("grain", { amount: 0.12 })],
  },
  {
    slug: "pixel-diamonds",
    name: "Pixel diamonds",
    category: "Glitch",
    build: () => [withParams("pixelate", { size: 24, shape: "diamond" })],
  },
  {
    slug: "mosaic-tiles",
    name: "Mosaic tiles",
    category: "Glitch",
    build: () => [withParams("mosaic", { size: 22, gap: 0.12 })],
  },
  {
    slug: "lego",
    name: "LEGO",
    category: "Glitch",
    build: () => [withParams("lego", { size: 24 })],
  },
  {
    slug: "crt",
    name: "CRT",
    category: "Glitch",
    build: () => [
      withParams("scanlines", { spacing: 3, intensity: 0.4 }),
      withParams("chromatic", { amount: 3 }),
      withParams("vignette", { amount: 0.5 }),
    ],
  },

  // ---------------------------------------------------------------- Scene
  // Generative-source looks — these carry a `source` (clouds/caustics/sky
  // pattern) and replace it on apply, unlike every preset above.
  {
    slug: "storybook-clouds",
    name: "Storybook clouds",
    category: "Scene",
    curated: true,
    source: {
      mode: "pattern",
      pattern: { type: "clouds", cell: 22, weight: 0.5, jitter: 0.35, angle: 35, stagger: false, fg: "#f7f2e8", bg: "#8fb8d8" },
    },
    build: () => [withParams("grain", { amount: 0.1 }), withParams("vignette", { amount: 0.25 })],
  },
  {
    slug: "poolside",
    name: "Poolside",
    category: "Scene",
    curated: true,
    source: {
      mode: "pattern",
      pattern: { type: "caustics", cell: 40, weight: 0.4, jitter: 0.3, angle: 0, stagger: true, fg: "#eafcff", bg: "#1f8ba8" },
    },
    build: () => [withParams("bloom", { intensity: 0.5, threshold: 0.6 }), withParams("tint", { color: "#9fe8f0", opacity: 0.15, blend: "screen" })],
  },
  {
    slug: "sundown-sky",
    name: "Sundown sky",
    category: "Scene",
    source: {
      mode: "pattern",
      pattern: { type: "sky", cell: 36, weight: 0.6, jitter: 0.35, angle: 25, stagger: false, fg: "#f2a65a", bg: "#2d4a7a" },
    },
    build: () => [withParams("grain", { amount: 0.08 })],
  },
];

export const CURATED_PRESETS = PRESETS.filter((p) => p.curated);
export const PRESET_CATEGORY_ORDER: PresetCategory[] = ["Print", "Text", "Paint", "Film", "Grade", "Glitch", "Scene"];
