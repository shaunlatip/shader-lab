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

// Reuse the existing curated background set (served statically).
export const GALLERY: GalleryImage[] = [
  mk("mon-sunrise", "Sunrise"),
  mk("mon-poppies", "Poppies"),
  mk("mon-lilies", "Lilies"),
  mk("mon-clouds", "Sky"),
  mk("mon-wisteria", "Wisteria"),
  mk("mon-haystack", "Haystack"),
  mk("photo-ridges", "Ridges"),
  mk("photo-water", "Water"),
  mk("photo-dunes", "Dunes"),
  mk("photo-fog", "Fog"),
  mk("photo-clouds", "Cloud"),
  mk("env-dawn", "Dawn"),
  mk("env-ridges", "Ridges II"),
  mk("env-water", "Water II"),
  mk("env-clouds", "Cloud II"),
  mk("env-dune", "Dune"),
  mk("atmo-dusk", "Dusk", "jpg"),
  mk("atmo-charles", "Charles", "jpg"),
  mk("atmo-foliage", "Foliage", "jpg"),
];

export function galleryUrl(id: string | null): string | null {
  if (!id) return null;
  const g = GALLERY.find((x) => x.id === id);
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
  /** Section header in the Saved panel — turns the 40+ flat chip wall into
   * scannable clusters. Every preset belongs to exactly one group. */
  group: PresetGroup;
  build: () => Effect[];
  /** Optional source the preset carries (generative-source looks — clouds,
   * caustics, sky). Merged into the current source on apply; presets without
   * it keep the user's source, as before. */
  source?: Partial<SourceState>;
}

export const PRESET_GROUPS = [
  "Pixel & tiles",
  "Print & dither",
  "Painterly & ink",
  "Type & glyphs",
  "Retro screen",
  "Warp & texture",
  "Grades",
] as const;
export type PresetGroup = (typeof PRESET_GROUPS)[number];

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
function inspireStack(): Effect[] {
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

/** Inspire from a random Pexels photo: random tag + page through /api/pexels,
 * random pick from the results. Falls back to the gallery when the key is
 * missing (route returns 501), the fetch fails, or a page comes back empty —
 * the button must always produce a look. */
export async function inspireFromPexels(): Promise<BgConfig> {
  try {
    const tag = pick([...PEXELS_TAGS]);
    const page = 1 + Math.floor(Math.random() * 3);
    const r = await fetch(`/api/pexels?q=${encodeURIComponent(tag)}&page=${page}&type=photo`);
    if (!r.ok) return inspire();
    const data = (await r.json()) as { results?: { full: string }[] };
    const results = data.results ?? [];
    if (results.length === 0) return inspire();
    const photo = pick(results);
    return {
      version: 1,
      output: { aspect: "3:2", longEdge: 2000 },
      source: { mode: "image", imageId: `pexels:${photo.full}`, solidColor: "#cdd9e0" },
      stack: inspireStack(),
    };
  } catch {
    return inspire();
  }
}

// Curated looks distilled from the effect explorations. Applying a preset
// replaces the current stack (source + output are kept). Ordered by group;
// the Saved panel renders one labeled cluster per group.
export const PRESETS: Preset[] = [
  // --- Pixel & tiles ---
  {
    name: "Pixel + grain",
    group: "Pixel & tiles",
    build: () => [withParams("pixelate", { size: 14 }), withParams("grain", { amount: 0.18 })],
  },
  {
    name: "Pixel dots",
    group: "Pixel & tiles",
    build: () => [withParams("pixelate", { size: 22, shape: "circle" }), withParams("grain", { amount: 0.12 })],
  },
  {
    name: "Pixel diamonds",
    group: "Pixel & tiles",
    build: () => [withParams("pixelate", { size: 24, shape: "diamond" })],
  },
  {
    name: "Mosaic tiles",
    group: "Pixel & tiles",
    build: () => [withParams("mosaic", { size: 22, gap: 0.12 })],
  },
  {
    name: "LEGO",
    group: "Pixel & tiles",
    build: () => [withParams("lego", { size: 24 })],
  },
  // --- Print & dither ---
  {
    name: "Newsprint",
    group: "Print & dither",
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 8, mode: "mono", aa: true })],
  },
  {
    name: "CMYK print",
    group: "Print & dither",
    build: () => [withParams("halftone", { cell: 9, mode: "cmyk", aa: true })],
  },
  {
    name: "Halftone rings",
    group: "Print & dither",
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 12, mode: "mono", dotShape: "ring" })],
  },
  {
    name: "Gooey halftone",
    group: "Print & dither",
    build: () => [withParams("halftone", { cell: 12, gooey: 0.75, overflow: 0.3 })],
  },
  {
    name: "Floyd dither",
    group: "Print & dither",
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 2, mono: true })],
  },
  {
    name: "Blue noise",
    group: "Print & dither",
    build: () => [withParams("dither", { type: "blueNoise", levels: 2, mono: true })],
  },
  {
    name: "Bayer dither",
    group: "Print & dither",
    build: () => [withParams("dither", { type: "bayer4", levels: 2, mono: true })],
  },
  {
    name: "Coarse Bayer",
    group: "Print & dither",
    build: () => [withParams("dither", { type: "bayer8", levels: 2, scale: 3, mono: true })],
  },
  {
    name: "Floyd colour",
    group: "Print & dither",
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 3, mono: false })],
  },
  {
    name: "Threshold ink",
    group: "Print & dither",
    build: () => [withParams("threshold", { level: 0.5 }), withParams("grain", { amount: 0.1 })],
  },
  {
    name: "Risograph",
    group: "Print & dither",
    build: () => [
      withParams("posterize", { levels: 4 }),
      makeEffect("gradientMap"),
      withParams("grain", { amount: 0.22, blend: "multiply" }),
    ],
  },
  // --- Painterly & ink (the GPU-heavy looks — all realtime post-P1/P3) ---
  {
    name: "Oil paint",
    group: "Painterly & ink",
    build: () => [withParams("kuwahara", { quality: "smooth", radius: 6 }), withParams("adjust", { saturation: 1.15, contrast: 1.05 })],
  },
  {
    name: "Ink sketch",
    group: "Painterly & ink",
    build: () => [withParams("lineArt", { mode: "outline", thickness: 1.8, threshold: 0.35 }), withParams("grain", { amount: 0.06 })],
  },
  {
    name: "Soft focus",
    group: "Painterly & ink",
    build: () => [withParams("blur", { radius: 10 }), withParams("bloom", { intensity: 0.6, threshold: 0.65 })],
  },
  {
    name: "Bloom",
    group: "Painterly & ink",
    build: () => [withParams("adjust", { contrast: 1.15, saturation: 1.2 }), withParams("bloom", { intensity: 0.8, threshold: 0.6 })],
  },
  {
    name: "Poster pop",
    group: "Painterly & ink",
    build: () => [withParams("posterize", { levels: 5, perChannel: true }), withParams("adjust", { saturation: 1.4, contrast: 1.1 })],
  },
  // --- Type & glyphs (ascii-magic parity) ---
  {
    name: "ASCII art",
    group: "Type & glyphs",
    build: () => [withParams("ascii", { cell: 10, ink: "#e9e4d8", paper: "#16140f" }), withParams("grain", { amount: 0.08 })],
  },
  {
    name: "ASCII colour",
    group: "Type & glyphs",
    build: () => [withParams("ascii", { cell: 9, colorMode: "source", paper: "#0a0a0a" })],
  },
  {
    name: "ASCII glow",
    group: "Type & glyphs",
    build: () => [
      withParams("ascii", { cell: 9, ink: "#9affc0", paper: "#04120a" }),
      withParams("characterBloom", { intensity: 0.8, threshold: 0.4 }),
    ],
  },
  {
    name: "Block print",
    group: "Type & glyphs",
    build: () => [withParams("blockChars", { cell: 9, colorMode: "source" })],
  },
  {
    name: "Crosshatch",
    group: "Type & glyphs",
    build: () => [makeEffect("grayscale"), withParams("crosshatch", { cell: 9 })],
  },
  {
    name: "Diamonds",
    group: "Type & glyphs",
    build: () => [withParams("diamond", { cell: 12, colorMode: "source", paper: "#101010" })],
  },
  {
    name: "Rain lines",
    group: "Type & glyphs",
    build: () => [withParams("lines", { cell: 7 })],
  },
  {
    name: "Halftone dots",
    group: "Type & glyphs",
    build: () => [makeEffect("grayscale"), withParams("glyphDots", { cell: 9, ink: "#111111", paper: "#f3efe6" })],
  },
  // --- Retro screen ---
  {
    name: "CRT",
    group: "Retro screen",
    build: () => [
      withParams("scanlines", { spacing: 3, intensity: 0.4 }),
      withParams("chromatic", { amount: 3 }),
      withParams("vignette", { amount: 0.5 }),
    ],
  },
  {
    name: "CRT curve",
    group: "Retro screen",
    build: () => [
      withParams("scanlines", { spacing: 3, intensity: 0.35 }),
      withParams("crtCurvature", { amount: 0.3, edge: 0.4 }),
      withParams("vignette", { amount: 0.5 }),
    ],
  },
  {
    name: "Scanlines RGB",
    group: "Retro screen",
    build: () => [withParams("scanlines", { spacing: 6, intensity: 0.6, rgbCells: true })],
  },
  {
    name: "VHS glitch",
    group: "Retro screen",
    build: () => [
      withParams("chromatic", { amount: 4, mode: "split" }),
      withParams("glitch", { amount: 0.45 }),
      withParams("scanlines", { spacing: 3, intensity: 0.3 }),
      withParams("filmDust", { amount: 0.25 }),
    ],
  },
  {
    name: "Chromatic",
    group: "Retro screen",
    build: () => [withParams("chromatic", { amount: 8 }), withParams("grain", { amount: 0.12 })],
  },
  {
    name: "Dispersion",
    group: "Retro screen",
    build: () => [withParams("chromatic", { amount: 8, samples: 8, quality: "high" }), withParams("grain", { amount: 0.08 })],
  },
  {
    name: "Vaporwave",
    group: "Retro screen",
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
  // --- Warp & texture ---
  {
    name: "Warp",
    group: "Warp & texture",
    build: () => [withParams("displace", { amount: 24, scale: 4 }), makeEffect("grayscale")],
  },
  {
    name: "Sine warp",
    group: "Warp & texture",
    build: () => [withParams("displace", { amount: 30, scale: 4, type: "sine" })],
  },
  {
    name: "Heavy grain",
    group: "Warp & texture",
    build: () => [makeEffect("grayscale"), withParams("grain", { amount: 0.5, mono: true })],
  },
  {
    name: "Colour wash",
    group: "Warp & texture",
    build: () => [withParams("tint", { color: "#e8c9a8", opacity: 0.45, blend: "multiply" }), withParams("grain", { amount: 0.1 })],
  },
  {
    name: "Vignette fade",
    group: "Warp & texture",
    build: () => [withParams("adjust", { contrast: 1.1 }), withParams("vignette", { amount: 0.8, radius: 0.7 })],
  },
  // Generative-source looks — these carry a `source` (clouds/caustics/sky
  // pattern) and replace it on apply, unlike every preset above.
  {
    name: "Storybook clouds",
    group: "Warp & texture",
    source: {
      mode: "pattern",
      pattern: { type: "clouds", cell: 22, weight: 0.5, jitter: 0.35, angle: 35, stagger: false, fg: "#f7f2e8", bg: "#8fb8d8" },
    },
    build: () => [withParams("grain", { amount: 0.1 }), withParams("vignette", { amount: 0.25 })],
  },
  {
    name: "Poolside",
    group: "Warp & texture",
    source: {
      mode: "pattern",
      pattern: { type: "caustics", cell: 40, weight: 0.4, jitter: 0.3, angle: 0, stagger: true, fg: "#eafcff", bg: "#1f8ba8" },
    },
    build: () => [withParams("bloom", { intensity: 0.5, threshold: 0.6 }), withParams("tint", { color: "#9fe8f0", opacity: 0.15, blend: "screen" })],
  },
  {
    name: "Sundown sky",
    group: "Warp & texture",
    source: {
      mode: "pattern",
      pattern: { type: "sky", cell: 36, weight: 0.6, jitter: 0.35, angle: 25, stagger: false, fg: "#f2a65a", bg: "#2d4a7a" },
    },
    build: () => [withParams("grain", { amount: 0.08 })],
  },
  // --- Grades ---
  {
    name: "Duotone",
    group: "Grades",
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
    name: "Sepia film",
    group: "Grades",
    build: () => [makeEffect("gradientMap"), withParams("grain", { amount: 0.16 }), withParams("vignette", { amount: 0.5 })],
  },
  {
    name: "Grade · B&W",
    group: "Grades",
    build: () => [makeEffect("grayscale"), withParams("adjust", { contrast: 1.15 })],
  },
  {
    name: "Grade · Sepia",
    group: "Grades",
    build: () => [
      makeEffect("grayscale"),
      withParams("gradientMap", { stops: [{ t: 0, color: "#241a12" }, { t: 1, color: "#f2e3cb" }], amount: 0.85 }),
    ],
  },
  {
    name: "Grade · Warm",
    group: "Grades",
    build: () => [withParams("adjust", { temperature: 0.3, saturation: 1.1 })],
  },
  {
    name: "Grade · Cool",
    group: "Grades",
    build: () => [withParams("adjust", { temperature: -0.3, saturation: 1.05 })],
  },
  {
    name: "Grade · Vintage",
    group: "Grades",
    build: () => [
      withParams("adjust", { contrast: 0.9, saturation: 0.8 }),
      withParams("tint", { color: "#e8c9a8", opacity: 0.2, blend: "soft-light" }),
      withParams("vignette", { amount: 0.4 }),
      withParams("grain", { amount: 0.1 }),
    ],
  },
  {
    name: "Grade · Fade",
    group: "Grades",
    build: () => [withParams("adjust", { contrast: 0.8, gamma: 1.25 })],
  },
  {
    name: "Grade · Cyber",
    group: "Grades",
    build: () => [
      withParams("gradientMap", { stops: [{ t: 0, color: "#06122a" }, { t: 0.5, color: "#1ea7b6" }, { t: 1, color: "#f06" }], amount: 0.6 }),
      withParams("chromatic", { amount: 4 }),
    ],
  },
  {
    name: "Golden hour",
    group: "Grades",
    build: () => [
      withParams("lightRays", { y: 22, threshold: 0.55, strength: 0.9, color: "#ffcf9a" }),
      withParams("tint", { color: "#e8a86a", opacity: 0.2, blend: "soft-light" }),
      withParams("vignette", { amount: 0.35 }),
    ],
  },
  {
    name: "God rays",
    group: "Grades",
    build: () => [
      withParams("adjust", { contrast: 1.1 }),
      withParams("lightRays", { samples: 48, density: 0.95, decay: 0.94, strength: 1.1 }),
      withParams("grain", { amount: 0.08 }),
    ],
  },
  {
    name: "Brushwork",
    group: "Painterly & ink",
    build: () => [
      withParams("kuwahara", { quality: "anisotropic", radius: 7, anisotropy: 1.6 }),
      withParams("adjust", { saturation: 1.15 }),
      withParams("grain", { amount: 0.06 }),
    ],
  },
];
