// BG Lab — curated gallery, seed search tags, and the default config / presets.

import { nanoid } from "nanoid";
import { defaultParams } from "./catalog";
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
// Real scanned CC0 materials — the honest answer to the richest Editions grounds
// (Winter '26's paper/plaster is photographed, not procedural). Retint over these
// with a Surface preset (see "Warm paper" / "Cool plaster") for the ground.
const mkTex = (id: string, label: string): GalleryImage => ({ id, label, url: `/textures/${id}.jpg` });

export const GALLERY: GalleryImage[] = [
  mk("mon-haystack", "Haystack"),
  mk("mon-sunrise", "Sunrise"),
  mk("mon-poppies", "Poppies"),
  mk("photo-fog", "Fog"),
  mk("photo-dunes", "Dunes"),
  mk("atmo-charles", "Charles", "jpg"),
];

// Material scans live in their own list — surfaced via Source → Generated →
// Texture (not the photo gallery), since they're a distinct source register
// (real scanned ground, not a photo subject) grouped with Gradient/Pattern.
export const TEXTURES: GalleryImage[] = [
  mkTex("tex-paper", "Paper"),
  mkTex("tex-plaster", "Plaster"),
  mkTex("tex-fabric", "Fabric"),
  mkTex("tex-manuscript", "Manuscript"),
];

export function isTextureId(id: string | null | undefined): boolean {
  return !!id && TEXTURES.some((t) => t.id === id);
}

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
  const g = GALLERY.find((x) => x.id === resolved) ?? TEXTURES.find((x) => x.id === resolved);
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

/** First visit (and Reset) opens on the lead example — a video already running
 * through a preset — so the canvas shows what the lab does before any input.
 * 16:9 matches the example videos. */
export function makeDefaultConfig(): BgConfig {
  const lead = EXAMPLES[0];
  return {
    version: 1,
    output: { aspect: "16:9", longEdge: 2000 },
    source: { mode: "video", imageId: exampleSourceId(lead), solidColor: "#cdd9e0" },
    stack: presetBySlug(lead.preset)?.build() ?? [makeEffect("pixelate"), makeEffect("grain")],
  };
}

export type PresetCategory = "Surface" | "Print" | "Text" | "Paint" | "Film" | "Grade" | "Glitch";

export interface Preset {
  /** Stable key — names the pre-rendered thumbnail at /presets/<slug>.webp. */
  slug: string;
  name: string;
  category: PresetCategory;
  /** Heroes appear as thumbnail cards in the gallery; the rest live behind
   * the all-presets search. */
  curated?: boolean;
  /** Presets only ever touch the effect stack, never the source — generative
   * looks (clouds/caustics/sky) live as Pattern-panel chips in the left
   * panel instead, so browsing/shuffling presets can never change what's
   * behind the effects. */
  build: () => Effect[];
}

/** Tweak one effect's params inline while building a preset. */
function withParams(type: EffectType, params: Record<string, ParamValue>): Effect {
  const e = makeEffect(type);
  e.params = { ...e.params, ...params };
  return e;
}

// ------------------------------------------------------------------ Randomize
// Randomize is scoped per surface (random image / video / preset / color /
// pattern) — the old all-in-one "Inspire me" config generator is gone.

export const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

/** A random gallery starter id — the offline fallback for random image. */
export function randomGalleryId(): string {
  return pick(GALLERY).id;
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

// The preset library. Curated heroes render as thumbnail cards in the
// gallery (grouped by category); the rest are reachable through the
// all-presets search. Applying a preset replaces the current stack only —
// source and output are always kept. Slugs are stable — they name the
// pre-rendered thumbnails in /public/presets/.
export const PRESETS: Preset[] = [
  // ---------------------------------------------------------------- Surface & light
  // Editions surface treatments — pair with a Gradient/Image source. These
  // touch only the stack (source stays whatever you picked), so a gradient +
  // "Sunlit" = the Horizons/dusk ground; a paper image + "Aged paper" = Winter '26.
  {
    slug: "sunlit",
    name: "Sunlit",
    category: "Surface",
    build: () => [
      withParams("gobo", { shape: "frond", softness: 8, strength: 0.32, angle: 14, lightAngle: 315 }),
      withParams("lightLeak", { warmth: 0.55, intensity: 0.42, angle: 315 }),
      withParams("grain", { amount: 0.06 }),
    ],
  },
  {
    slug: "aged-paper",
    name: "Aged paper",
    category: "Surface",
    build: () => [
      withParams("relief", { depth: 0.55, scale: 22, lightAzimuth: 100, lightElevation: 17 }),
      withParams("stain", { age: 0.5 }),
      withParams("grain", { amount: 0.05 }),
    ],
  },
  {
    slug: "poolside",
    name: "Poolside",
    category: "Surface",
    build: () => [
      withParams("caustic", { intensity: 0.4, scale: 6, warmth: 0.25 }),
      withParams("grain", { amount: 0.05 }),
    ],
  },
  {
    slug: "blinds",
    name: "Venetian light",
    category: "Surface",
    build: () => [
      withParams("gobo", { shape: "blinds", softness: 5, strength: 0.28, angle: -8, lightAngle: 300 }),
      withParams("lightLeak", { warmth: 0.7, intensity: 0.34, angle: 300 }),
      withParams("grain", { amount: 0.05 }),
    ],
  },
  // Retint moves for the material scans (pick a texture in the gallery first):
  // desaturate slightly, warm/cool tint, keep the tooth, light vignette.
  {
    slug: "warm-paper",
    name: "Warm paper",
    category: "Surface",
    build: () => [
      withParams("adjust", { saturation: 0.7, contrast: 1.03 }),
      withParams("tint", { color: "#c8b48a", opacity: 0.2, blend: "multiply" }),
      withParams("stain", { age: 0.35 }),
      withParams("vignette", { amount: 0.18 }),
      withParams("grain", { amount: 0.04 }),
    ],
  },
  {
    slug: "cool-plaster",
    name: "Cool plaster",
    category: "Surface",
    build: () => [
      withParams("adjust", { saturation: 0.55 }),
      withParams("tint", { color: "#c3cbd2", opacity: 0.16, blend: "soft-light" }),
      withParams("vignette", { amount: 0.16 }),
      withParams("grain", { amount: 0.04 }),
    ],
  },

  // ---------------------------------------------------------------- Paint
  // maximeheckel-adjacent painterly/structural effects lead the gallery:
  // Kuwahara first, then line art.
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
    // XDoG, not Sobel outline: the hard-threshold outline goes sparse on
    // smooth subjects and blobby on texture. XDoG keeps edge emphasis plus a
    // tonal fill, so it reads as a pen drawing on any source. Low threshold
    // keeps most of the frame paper.
    build: () => [
      withParams("lineArt", { mode: "xdog", sigma: 1.5, threshold: 0.35, edgeSoftness: 14 }),
      withParams("grain", { amount: 0.05 }),
    ],
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

  // ---------------------------------------------------------------- Print
  // Dither, dots, halftone — in that priority order.
  // Ordered Bayer 8×8 leads Print, not Floyd–Steinberg: diffusion dithers at
  // single-pixel pitch (it ignores cell scale) and reshuffles every video
  // frame, so it reads as noise. Bayer's fixed matrix is stable in motion.
  // Colour dither (per-channel, 2 levels = 8-colour palette) — Shaun's tuned
  // stack. The ink/paper gradient map ships disabled: one toggle turns it
  // into the mono print variant.
  {
    slug: "bayer-dither",
    name: "Bayer 8×8",
    category: "Print",
    curated: true,
    build: () => {
      const inkPaper = withParams("gradientMap", {
        stops: [
          { t: 0, color: "#16140f" },
          { t: 1, color: "#f1ece4" },
        ],
      });
      inkPaper.enabled = false;
      return [
        withParams("adjust", { contrast: 1.15 }),
        withParams("dither", { type: "bayer8", levels: 2, scale: 3, mono: false }),
        inkPaper,
      ];
    },
  },
  {
    slug: "floyd-dither",
    name: "Floyd dither",
    category: "Print",
    build: () => [withParams("dither", { type: "floydSteinberg", levels: 2, mono: true })],
  },
  // The Halftone effect's showcase: a tone pre-pass (brighter + harder) clears
  // skies and midtones to paper so subjects print as bold riso-red screens,
  // with only a light dot gradient left in the highlights. Square dots on a
  // 46° screen — Shaun's tuned stack (Copy spec, 2026-09-25).
  {
    slug: "riso-halftone",
    name: "Riso halftone",
    category: "Print",
    curated: true,
    build: () => [
      withParams("adjust", { brightness: 1.15, contrast: 1.4 }),
      withParams("halftone", { cell: 10, angle: 46, dotShape: "square", ink: "#d9412b", paper: "#f3ecdf" }),
      withParams("grain", { amount: 0.05, blend: "multiply" }),
    ],
  },
  {
    slug: "halftone-dots",
    name: "Halftone dots",
    category: "Print",
    build: () => [makeEffect("grayscale"), withParams("glyphDots", { cell: 9, ink: "#111111", paper: "#f3efe6" })],
  },
  {
    slug: "newsprint",
    name: "Newsprint",
    category: "Print",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("halftone", { cell: 8, mode: "mono", aa: true })],
  },
  // Softened contrast + gooey dots so the four screens merge into ink blobs —
  // Shaun's tuned stack on the Koi example (Copy spec, 2026-09-25).
  {
    slug: "cmyk-print",
    name: "CMYK print",
    category: "Print",
    curated: true,
    build: () => [withParams("halftone", { cell: 9, mode: "cmyk", aa: true, contrast: 0.8, gooey: 0.54 })],
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
    slug: "crosshatch",
    name: "Crosshatch",
    category: "Print",
    curated: true,
    build: () => [makeEffect("grayscale"), withParams("crosshatch", { cell: 9 })],
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

  // ---------------------------------------------------------------- Glitch
  // Mosaic leads — the last of the explicitly prioritized effects. Values are
  // Shaun's tuned stack on the Surf example (Copy spec, 2026-09-25).
  {
    slug: "mosaic-tiles",
    name: "Mosaic tiles",
    category: "Glitch",
    curated: true,
    build: () => [withParams("mosaic", { size: 19, gap: 0.14, shape: "square" })],
  },
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
];

export const CURATED_PRESETS = PRESETS.filter((p) => p.curated);
// Priority order per the maximeheckel-style effects: Paint (Kuwahara, line
// art) leads, then Print (dither/dots/halftone), then Glitch (mosaic).
export const PRESET_CATEGORY_ORDER: PresetCategory[] = ["Surface", "Paint", "Print", "Glitch", "Text", "Film", "Grade"];

export function presetBySlug(slug: string): Preset | undefined {
  return PRESETS.find((p) => p.slug === slug);
}

// ------------------------------------------------------------------ Examples
// Examples: a free Pexels video paired with a preset — the onboarding surface
// under the canvas. Subjects stay in nature — landscape, flora, simple fauna
// (fish, jellyfish, butterflies); no people or mammals. Each pairing was
// picked so the subject shows the effect off (a white jellyfish on black for
// ASCII glow, a crowd of koi for CMYK dots), alternating color and mono.
// Every preset here runs as a GL pass, so the examples play at full frame
// rate. Videos stream from the Pexels CDN (CORS *, so exports stay
// untainted); the Pexels license needs no attribution, credit is courtesy.
// Order is the rail order; EXAMPLES[0] is the landing example.
// Taxonomy (user-facing too): a *preset* is an effect stack that applies to
// any source; an *example* is a source + preset pairing.
export interface Example {
  /** Stable key — names the thumbnail at /examples/<slug>.webp. */
  slug: string;
  subject: string;
  /** Preset slug applied on top of the video. */
  preset: string;
  /** mp4 on the Pexels CDN (~720p). */
  video: string;
  /** Pexels poster frame — the /dev/thumbs source for the example thumbnail. */
  poster: string;
  credit: string;
  /** The video's Pexels page (as returned by the API) — cited by Copy spec. */
  page: string;
}

const pexelsPoster = (id: string, file: string) =>
  `https://images.pexels.com/videos/${id}/${file}?auto=compress&cs=tinysrgb&fit=crop&h=630&w=1200`;

export const EXAMPLES: Example[] = [
  {
    slug: "jellyfish-ascii",
    subject: "Jellyfish",
    preset: "ascii-glow",
    video: "https://videos.pexels.com/video-files/11277955/11277955-hd_1280_720_31fps.mp4",
    poster: pexelsPoster("11277955", "jelly-fish-jelly-fish-underwater-jellyfish-jellyfish-tentacles-11277955.jpeg"),
    credit: "Yudha Aprilian",
    page: "https://www.pexels.com/video/jellyfish-under-water-11277955/",
  },
  {
    slug: "koi-cmyk",
    subject: "Koi",
    preset: "cmyk-print",
    video: "https://videos.pexels.com/video-files/6392574/6392574-hd_1280_720_30fps.mp4",
    poster: pexelsPoster("6392574", "pexels-photo-6392574.jpeg"),
    credit: "Piya Nimityongskul",
    page: "https://www.pexels.com/video/colorful-fishes-in-a-river-6392574/",
  },
  {
    slug: "palms-halftone",
    subject: "Palms",
    preset: "riso-halftone",
    video: "https://videos.pexels.com/video-files/19434489/19434489-hd_1280_720_24fps.mp4",
    poster: pexelsPoster("19434489", "afternoon-bend-bending-blow-19434489.jpeg"),
    credit: "Emmett Loverde",
    page: "https://www.pexels.com/video/san-diego-palm-trees-blowing-in-storm-winds-19434489/",
  },
  {
    slug: "butterfly-oil",
    subject: "Butterfly",
    preset: "oil-paint",
    video: "https://videos.pexels.com/video-files/35020795/14835619_1280_720_24fps.mp4",
    poster: pexelsPoster("35020795", "pexels-photo-35020795.jpeg"),
    credit: "Tường Chopper",
    page: "https://www.pexels.com/video/vibrant-butterfly-on-yellow-flowers-in-summer-35020795/",
  },
  {
    // Timelapse: the clouds keep moving, and their soft gradients give the
    // 8×8 matrix the full tonal range to show off.
    slug: "clouds-bayer",
    subject: "Clouds",
    preset: "bayer-dither",
    video: "https://videos.pexels.com/video-files/5865939/5865939-hd_1280_720_30fps.mp4",
    poster: pexelsPoster("5865939", "pexels-photo-5865939.jpeg"),
    credit: "Tolga KARAKAYA",
    page: "https://www.pexels.com/video/time-lapse-video-of-white-clouds-in-the-sky-5865939/",
  },
  {
    // Pixel dots needs motion to read — flowing lava keeps every dot changing.
    slug: "lava-dots",
    subject: "Lava",
    preset: "pixel-dots",
    video: "https://videos.pexels.com/video-files/20217377/20217377-hd_1280_720_25fps.mp4",
    poster: pexelsPoster("20217377", "lava-20217377.jpeg"),
    credit: "Eugenio Manghi",
    page: "https://www.pexels.com/video/lava-and-eruption-4-20217377/",
  },
  {
    slug: "surf-mosaic",
    subject: "Surf",
    preset: "mosaic-tiles",
    video: "https://videos.pexels.com/video-files/15226109/15226109-hd_1280_720_60fps.mp4",
    poster: pexelsPoster("15226109", "4k-sea-15226109.jpeg"),
    credit: "Salva F. Ayala",
    page: "https://www.pexels.com/video/4k-drone-mediterraneo-15226109/",
  },
];

/** The `imageId` a example's video uses (same scheme as Pexels video search). */
export function exampleSourceId(r: Example): string {
  return `pexels:video:${r.video}`;
}
