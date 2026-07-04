// BG Lab — the effect catalog. ONE source of truth that drives:
//   1. the rendered control rows (Sidebar)
//   2. the auto-generated schema text in the copy-paste AI prompt
//   3. clamp/validate of pasted configs
//   4. default params when an effect type is picked
// Add an effect = add a catalog entry + one engine op module. No UI edits.

import type { EffectType, GradientStop, ParamValue } from "./types";

/** Editor sections. Controls sharing a group render under one header; the
 * `advanced` group renders collapsed. Effects whose controls have NO group at
 * all (most of them) fall back to a single flat list. */
export type ControlGroup = "characters" | "intensity" | "background" | "advanced";

export const CONTROL_GROUP_LABEL: Record<ControlGroup, string> = {
  characters: "Characters",
  intensity: "Intensity",
  background: "Background",
  advanced: "Advanced",
};
export const CONTROL_GROUP_ORDER: ControlGroup[] = ["characters", "intensity", "background", "advanced"];

/** Conditional visibility — show the row only when params[key] is one of `in`. */
export interface ShowIf {
  key: string;
  in: ParamValue[];
}

interface ControlCommon {
  group?: ControlGroup;
  showIf?: ShowIf;
}

export type ControlSpec = ControlCommon &
  (
    | {
        kind: "slider";
        key: string;
        label: string;
        min: number;
        max: number;
        step: number;
        default: number;
        /** size-bearing param — multiplied by unit = W/1000 at render time so
         * export matches preview proportionally */
        unit?: boolean;
      }
    | {
        kind: "select";
        key: string;
        label: string;
        options: { value: string; label: string }[];
        default: string;
      }
    | { kind: "switch"; key: string; label: string; default: boolean }
    | { kind: "color"; key: string; label: string; default: string }
    | { kind: "text"; key: string; label: string; default: string; maxLen?: number }
    | { kind: "gradient"; key: string; label: string; default: GradientStop[] }
  );

/** add-effect menu groups: converters/styles vs the tone/color/post post-processors */
export type CategoryId = "converter" | "tone" | "color" | "post";

export const CATEGORY_LABEL: Record<CategoryId, string> = {
  converter: "Converters",
  tone: "Tone",
  color: "Color",
  post: "Post",
};

export const CATEGORY_ORDER: CategoryId[] = ["converter", "tone", "color", "post"];

export interface EffectMeta {
  type: EffectType;
  label: string;
  /** one-line description, shown in the add-combobox */
  blurb: string;
  /** add-effect menu grouping */
  category: CategoryId;
  /** flag the live-perf hot-spots */
  heavy?: boolean;
  controls: ControlSpec[];
}

const BLENDS = ["soft-light", "overlay", "multiply", "screen"].map((v) => ({
  value: v,
  label: v,
}));

// Shared controls for the glyph family (ASCII, block, hatch, diamond, lines, …).
// Each style overrides the glyph set, color mode and draw mode.
function glyphControls(o: {
  cell: number;
  glyphs: string;
  colorMode: "ink" | "source";
  sizeByBrightness: boolean;
}): ControlSpec[] {
  return [
    // --- Characters: the glyph look ---
    { kind: "slider", group: "characters", key: "cell", label: "Size", min: 4, max: 48, step: 1, default: o.cell, unit: true },
    {
      kind: "select",
      group: "characters",
      key: "charSet",
      label: "Character set",
      options: [
        { value: "standard", label: "standard" },
        { value: "detailed", label: "detailed" },
        { value: "minimal", label: "minimal" },
        { value: "custom", label: "custom…" },
      ],
      default: "custom",
    },
    // Raw glyph string only when the user picks "custom" — otherwise the preset
    // (or this style's built-in set) drives it. Folds two rows into one.
    { kind: "text", group: "characters", key: "glyphs", label: "Glyphs", default: o.glyphs, maxLen: 64, showIf: { key: "charSet", in: ["custom"] } },
    {
      kind: "select",
      group: "characters",
      key: "blendMode",
      label: "Blend",
      options: [
        { value: "normal", label: "normal" },
        { value: "overlay", label: "overlay" },
        { value: "colorDodge", label: "color dodge" },
        { value: "screen", label: "screen" },
        { value: "lighter", label: "lighter" },
      ],
      default: "normal",
    },
    { kind: "slider", group: "characters", key: "charOpacity", label: "Char opacity", min: 0, max: 1, step: 0.01, default: 1 },
    { kind: "switch", group: "characters", key: "invert", label: "Invert", default: false },
    { kind: "switch", group: "characters", key: "dotGrid", label: "Dot grid", default: false },

    // --- Intensity: how the image maps onto the grid ---
    { kind: "slider", group: "intensity", key: "coverage", label: "Coverage", min: 0, max: 1, step: 0.01, default: 1 },
    { kind: "slider", group: "intensity", key: "density", label: "Density", min: 0.5, max: 1.8, step: 0.05, default: 1 },
    { kind: "slider", group: "intensity", key: "edgeEmphasis", label: "Edge emphasis", min: 0, max: 1, step: 0.01, default: 0 },
    { kind: "slider", group: "intensity", key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01, default: 0 },
    { kind: "slider", group: "intensity", key: "contrast", label: "Contrast", min: 0.3, max: 2.5, step: 0.05, default: 1 },

    // --- Background: what sits behind the glyphs ---
    {
      kind: "select",
      group: "background",
      key: "background",
      label: "Mode",
      options: [
        { value: "paper", label: "paper" },
        { value: "original", label: "original image" },
        { value: "blurred", label: "blurred image" },
        { value: "transparent", label: "transparent" },
      ],
      // Ramp styles (ASCII/block/mixed): default to a *blurred* copy of the source
      // behind the dense glyphs — "based on the image", matching ascii-magic. Shape
      // styles (dots/diamond/lines — sizeByBrightness): default to flat *paper* instead,
      // because sparse source-coloured shapes drawn over the same (blurred) photo
      // camouflage into it and read as nearly invisible. Paper keeps the image colour
      // on the shapes while making them apparent.
      default: o.sizeByBrightness ? "paper" : "blurred",
    },
    { kind: "slider", group: "background", key: "bgBlur", label: "Blur", min: 0, max: 40, step: 0.5, default: 8, unit: true, showIf: { key: "background", in: ["blurred"] } },

    // --- Advanced: rarely touched / style-identity knobs ---
    {
      kind: "select",
      group: "advanced",
      key: "colorMode",
      label: "Color",
      options: [
        { value: "source", label: "from image" },
        { value: "ink", label: "solid ink" },
      ],
      default: o.colorMode,
    },
    { kind: "color", group: "advanced", key: "ink", label: "Ink", default: "#e9e4d8", showIf: { key: "colorMode", in: ["ink"] } },
    { kind: "color", group: "advanced", key: "paper", label: "Paper", default: "#16140f", showIf: { key: "background", in: ["paper"] } },
    { kind: "slider", group: "advanced", key: "fontScale", label: "Font scale", min: 0.3, max: 2, step: 0.05, default: 1 },
    { kind: "switch", group: "advanced", key: "sizeByBrightness", label: "Size by brightness", default: o.sizeByBrightness },
    { kind: "switch", group: "advanced", key: "randomize", label: "Randomize", default: false },
  ];
}

export const EFFECT_CATALOG: Record<EffectType, EffectMeta> = {
  adjust: {
    type: "adjust",
    category: "tone",
    label: "Adjust",
    blurb: "Exposure, contrast, saturation, hue, temperature, gamma",
    controls: [
      { kind: "slider", key: "brightness", label: "Brightness", min: 0.4, max: 1.6, step: 0.01, default: 1 },
      { kind: "slider", key: "contrast", label: "Contrast", min: 0.4, max: 1.8, step: 0.01, default: 1 },
      { kind: "slider", key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01, default: 1 },
      { kind: "slider", key: "exposure", label: "Exposure", min: -1, max: 1, step: 0.01, default: 0 },
      { kind: "slider", key: "hue", label: "Hue", min: -180, max: 180, step: 1, default: 0 },
      { kind: "slider", key: "temperature", label: "Temperature", min: -1, max: 1, step: 0.01, default: 0 },
      { kind: "slider", key: "gamma", label: "Gamma", min: 0.2, max: 2.5, step: 0.01, default: 1 },
    ],
  },
  blur: {
    type: "blur",
    category: "tone",
    label: "Blur",
    blurb: "Gaussian, directional, radial-zoom or tilt-shift",
    controls: [
      { kind: "slider", key: "radius", label: "Radius", min: 0, max: 40, step: 0.5, default: 6, unit: true },
      {
        kind: "select",
        key: "mode",
        label: "Type",
        options: [
          { value: "gaussian", label: "gaussian" },
          { value: "directional", label: "directional" },
          { value: "radial", label: "radial zoom" },
          { value: "tiltShift", label: "tilt-shift" },
        ],
        default: "gaussian",
      },
      { kind: "slider", key: "angle", label: "Angle", min: 0, max: 360, step: 1, default: 0 },
      { kind: "slider", key: "center", label: "Focus Y", min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: "slider", key: "band", label: "Focus band", min: 0.05, max: 0.8, step: 0.01, default: 0.3 },
    ],
  },
  pixelate: {
    type: "pixelate",
    category: "converter",
    label: "Pixelate",
    blurb: "Blocky downscale",
    controls: [
      { kind: "slider", key: "size", label: "Block size", min: 2, max: 90, step: 1, default: 8, unit: true },
      {
        kind: "select",
        key: "shape",
        label: "Shape",
        options: [
          { value: "square", label: "square" },
          { value: "circle", label: "circle" },
          { value: "diamond", label: "diamond" },
        ],
        default: "square",
      },
    ],
  },
  posterize: {
    type: "posterize",
    category: "tone",
    label: "Posterize",
    blurb: "Quantize tones into bands",
    controls: [
      { kind: "slider", key: "levels", label: "Levels", min: 2, max: 16, step: 1, default: 5 },
      { kind: "switch", key: "perChannel", label: "Per-channel", default: false },
    ],
  },
  dither: {
    type: "dither",
    category: "converter",
    label: "Dither",
    blurb: "Ordered, blue-noise, or Floyd–Steinberg error diffusion",
    controls: [
      {
        kind: "select",
        key: "type",
        label: "Type",
        options: [
          { value: "bayer2", label: "Bayer 2×2" },
          { value: "bayer4", label: "Bayer 4×4" },
          { value: "bayer8", label: "Bayer 8×8" },
          { value: "blueNoise", label: "Blue noise" },
          { value: "stripes", label: "Stripes" },
          { value: "crossStripe", label: "Cross-stripe" },
          { value: "floydSteinberg", label: "Floyd–Steinberg" },
          { value: "atkinson", label: "Atkinson" },
          { value: "sierra", label: "Sierra-lite" },
        ],
        default: "bayer4",
      },
      { kind: "slider", key: "levels", label: "Levels", min: 2, max: 6, step: 1, default: 3 },
      { kind: "slider", key: "scale", label: "Cell scale", min: 1, max: 10, step: 1, default: 2, unit: true },
      { kind: "slider", key: "pixelate", label: "Pixelate", min: 0, max: 16, step: 1, default: 0, unit: true },
      { kind: "switch", key: "mono", label: "Monochrome", default: false },
      { kind: "switch", key: "serpentine", label: "Serpentine (FS)", default: true },
    ],
  },
  halftone: {
    type: "halftone",
    category: "converter",
    label: "Halftone",
    blurb: "Screened dots — mono or CMYK, anti-aliased",
    heavy: true,
    controls: [
      { kind: "slider", key: "cell", label: "Cell size", min: 3, max: 36, step: 1, default: 9, unit: true },
      { kind: "slider", key: "angle", label: "Angle", min: 0, max: 90, step: 1, default: 45 },
      { kind: "slider", key: "contrast", label: "Contrast", min: 0.3, max: 2.6, step: 0.05, default: 1 },
      {
        kind: "select",
        key: "dotShape",
        label: "Dot shape",
        options: [
          { value: "circle", label: "circle" },
          { value: "ring", label: "ring" },
          { value: "line", label: "line" },
          { value: "square", label: "square" },
          { value: "diamond", label: "diamond" },
        ],
        default: "circle",
      },
      {
        kind: "select",
        key: "mode",
        label: "Mode",
        options: [
          { value: "mono", label: "mono" },
          { value: "cmyk", label: "CMYK" },
        ],
        default: "mono",
      },
      { kind: "switch", key: "aa", label: "Anti-alias", default: true },
      { kind: "switch", key: "stagger", label: "Stagger", default: false },
      { kind: "switch", key: "invertCells", label: "Invert cells", default: false },
      { kind: "slider", key: "overflow", label: "Overflow", min: 0, max: 1, step: 0.01, default: 0 },
      { kind: "slider", key: "gooey", label: "Gooey", min: 0, max: 1, step: 0.01, default: 0 },
      { kind: "color", key: "ink", label: "Ink", default: "#191512" },
      { kind: "color", key: "paper", label: "Paper", default: "#f1ece4" },
    ],
  },
  gradientMap: {
    type: "gradientMap",
    category: "color",
    label: "Gradient map",
    blurb: "Map luminance to a color ramp (duotone+)",
    controls: [
      {
        kind: "gradient",
        key: "stops",
        label: "Ramp",
        default: [
          { t: 0, color: "#241a14" },
          { t: 1, color: "#f3e2cf" },
        ],
      },
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  threshold: {
    type: "threshold",
    category: "tone",
    label: "Threshold",
    blurb: "1-bit black & white cutoff",
    controls: [
      { kind: "slider", key: "level", label: "Level", min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 1 },
    ],
  },
  grayscale: {
    type: "grayscale",
    category: "tone",
    label: "Grayscale",
    blurb: "Desaturate",
    controls: [{ kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 1 }],
  },
  grain: {
    type: "grain",
    category: "post",
    label: "Grain",
    blurb: "Film grain / noise overlay",
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 0.7, step: 0.01, default: 0.14 },
      { kind: "slider", key: "size", label: "Size", min: 1, max: 6, step: 0.5, default: 1.5, unit: true },
      { kind: "switch", key: "mono", label: "Monochrome", default: true },
      { kind: "switch", key: "animate", label: "Animate", default: true },
      { kind: "select", key: "blend", label: "Blend", options: BLENDS, default: "soft-light" },
    ],
  },
  tint: {
    type: "tint",
    category: "color",
    label: "Tint / wash",
    blurb: "Flat color wash with blend mode",
    controls: [
      { kind: "color", key: "color", label: "Color", default: "#e8c9a8" },
      { kind: "slider", key: "opacity", label: "Opacity", min: 0, max: 1, step: 0.01, default: 0.25 },
      {
        kind: "select",
        key: "blend",
        label: "Blend",
        options: [...BLENDS, { value: "color", label: "color" }],
        default: "multiply",
      },
    ],
  },
  chromatic: {
    type: "chromatic",
    category: "post",
    label: "Chromatic aberration",
    blurb: "RGB channel dispersion",
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 20, step: 0.5, default: 4, unit: true },
      { kind: "slider", key: "angle", label: "Angle", min: 0, max: 360, step: 1, default: 0 },
      {
        kind: "select",
        key: "mode",
        label: "Mode",
        options: [
          { value: "radial", label: "radial" },
          { value: "linear", label: "linear" },
          { value: "split", label: "RGB split" },
        ],
        default: "radial",
      },
      // default 6 since the GL pass landed — multi-sample is free on GPU and
      // the smeared dispersion reads much better than the hard 1-sample split
      { kind: "slider", key: "samples", label: "Samples", min: 1, max: 16, step: 1, default: 6 },
      {
        kind: "select",
        key: "quality",
        label: "Quality",
        options: [
          { value: "normal", label: "normal" },
          { value: "high", label: "high" },
        ],
        default: "normal",
      },
      { kind: "slider", key: "saturation", label: "Saturation", min: 0, max: 2, step: 0.01, default: 1 },
    ],
  },
  scanlines: {
    type: "scanlines",
    category: "post",
    label: "Scanlines / CRT",
    blurb: "Horizontal scan lines",
    controls: [
      { kind: "slider", key: "spacing", label: "Spacing", min: 1, max: 12, step: 0.5, default: 3, unit: true },
      { kind: "slider", key: "intensity", label: "Intensity", min: 0, max: 1, step: 0.01, default: 0.3 },
      { kind: "switch", key: "rgbCells", label: "RGB cells", default: false },
    ],
  },
  vignette: {
    type: "vignette",
    category: "post",
    label: "Vignette",
    blurb: "Darkened edges",
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.4 },
      { kind: "slider", key: "radius", label: "Radius", min: 0, max: 1, step: 0.01, default: 0.75 },
      { kind: "slider", key: "softness", label: "Softness", min: 0, max: 1, step: 0.01, default: 0.45 },
      { kind: "color", key: "color", label: "Color", default: "#000000" },
    ],
  },
  bloom: {
    type: "bloom",
    category: "post",
    label: "Bloom / glow",
    blurb: "Blur bright areas back over the image",
    heavy: true,
    controls: [
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.7 },
      { kind: "slider", key: "intensity", label: "Intensity", min: 0, max: 1.5, step: 0.01, default: 0.5 },
      { kind: "slider", key: "radius", label: "Radius", min: 0, max: 40, step: 0.5, default: 12, unit: true },
    ],
  },
  sharpen: {
    type: "sharpen",
    category: "tone",
    label: "Sharpen",
    blurb: "Unsharp 3×3 convolution",
    controls: [{ kind: "slider", key: "amount", label: "Amount", min: 0, max: 2, step: 0.01, default: 0.6 }],
  },
  displace: {
    type: "displace",
    category: "post",
    label: "Displace / warp",
    blurb: "Noise or sine displacement",
    heavy: true,
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 60, step: 0.5, default: 12, unit: true },
      { kind: "slider", key: "scale", label: "Scale", min: 0.5, max: 12, step: 0.1, default: 3, unit: true },
      {
        kind: "select",
        key: "type",
        label: "Type",
        options: [
          { value: "noise", label: "noise" },
          { value: "sine", label: "sine" },
        ],
        default: "noise",
      },
    ],
  },

  // -------------------------------------------------- converters / styles
  ascii: {
    type: "ascii",
    category: "converter",
    label: "ASCII",
    blurb: "Classic text-character art from a brightness ramp",
    heavy: true,
    controls: glyphControls({ cell: 10, glyphs: "@#S08Xx+=-;:,. ", colorMode: "source", sizeByBrightness: false }),
  },
  blockChars: {
    type: "blockChars",
    category: "converter",
    label: "Block chars",
    blurb: "Unicode block glyphs — dense terminal aesthetic",
    heavy: true,
    controls: glyphControls({ cell: 9, glyphs: "█▓▒░ ", colorMode: "source", sizeByBrightness: false }),
  },
  mixed: {
    type: "mixed",
    category: "converter",
    label: "Mixed glyphs",
    blurb: "Rich multi-glyph ramp, sampled in source color",
    heavy: true,
    controls: glyphControls({ cell: 11, glyphs: "@#WM&8B%$Xx+=-:. ", colorMode: "source", sizeByBrightness: false }),
  },
  crosshatch: {
    type: "crosshatch",
    category: "converter",
    label: "Crosshatch",
    blurb: "Woven ✕ glyphs sized by darkness",
    heavy: true,
    controls: glyphControls({ cell: 10, glyphs: "╳", colorMode: "source", sizeByBrightness: true }),
  },
  diagonal: {
    type: "diagonal",
    category: "converter",
    label: "Diagonal hatch",
    blurb: "Slanted strokes — engraved texture",
    heavy: true,
    controls: glyphControls({ cell: 10, glyphs: "╱", colorMode: "source", sizeByBrightness: true }),
  },
  diamond: {
    type: "diamond",
    category: "converter",
    label: "Diamonds",
    blurb: "Jewel-like ◆ glyphs, brightness-sized",
    heavy: true,
    controls: glyphControls({ cell: 12, glyphs: "◆", colorMode: "source", sizeByBrightness: true }),
  },
  lines: {
    type: "lines",
    category: "converter",
    label: "Vertical lines",
    blurb: "Rain / barcode strokes — minimal, graphic",
    heavy: true,
    controls: glyphControls({ cell: 8, glyphs: "│", colorMode: "source", sizeByBrightness: true }),
  },
  glyphDots: {
    type: "glyphDots",
    category: "converter",
    label: "Dots",
    blurb: "Halftone-print circles scaled by brightness",
    heavy: true,
    controls: glyphControls({ cell: 10, glyphs: "●", colorMode: "source", sizeByBrightness: true }),
  },
  braille: {
    type: "braille",
    category: "converter",
    label: "Braille",
    blurb: "2×4 dot cells mapped to Unicode braille",
    heavy: true,
    controls: [
      { kind: "slider", group: "characters", key: "cell", label: "Dot size", min: 1.5, max: 14, step: 0.5, default: 4, unit: true },
      { kind: "slider", group: "characters", key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: "slider", group: "characters", key: "charOpacity", label: "Char opacity", min: 0, max: 1, step: 0.01, default: 1 },
      { kind: "switch", group: "characters", key: "invert", label: "Invert", default: false },
      {
        kind: "select",
        group: "background",
        key: "background",
        label: "Mode",
        options: [
          { value: "paper", label: "paper" },
          { value: "original", label: "original image" },
          { value: "blurred", label: "blurred image" },
          { value: "transparent", label: "transparent" },
        ],
        default: "blurred",
      },
      { kind: "slider", group: "background", key: "bgBlur", label: "Blur", min: 0, max: 40, step: 0.5, default: 8, unit: true, showIf: { key: "background", in: ["blurred"] } },
      {
        kind: "select",
        group: "advanced",
        key: "colorMode",
        label: "Color",
        options: [
          { value: "source", label: "from image" },
          { value: "ink", label: "solid ink" },
        ],
        default: "source",
      },
      { kind: "color", group: "advanced", key: "ink", label: "Ink", default: "#e9e4d8", showIf: { key: "colorMode", in: ["ink"] } },
      { kind: "color", group: "advanced", key: "paper", label: "Paper", default: "#16140f", showIf: { key: "background", in: ["paper"] } },
    ],
  },
  mosaic: {
    type: "mosaic",
    category: "converter",
    label: "Mosaic",
    blurb: "Coloured tiles sampled from the photo",
    controls: [
      { kind: "slider", key: "size", label: "Tile size", min: 4, max: 90, step: 1, default: 16, unit: true },
      { kind: "slider", key: "gap", label: "Gap", min: 0, max: 0.5, step: 0.01, default: 0 },
      {
        kind: "select",
        key: "shape",
        label: "Shape",
        options: [
          { value: "square", label: "square" },
          { value: "wide", label: "wide" },
          { value: "tall", label: "tall" },
        ],
        default: "square",
      },
    ],
  },
  lego: {
    type: "lego",
    category: "converter",
    label: "LEGO bricks",
    blurb: "Studded brick mosaic with raised-dot shading",
    heavy: true,
    controls: [{ kind: "slider", key: "size", label: "Brick size", min: 8, max: 80, step: 1, default: 22, unit: true }],
  },
  lineArt: {
    type: "lineArt",
    category: "converter",
    label: "Line art",
    blurb: "Sobel edge detection with outline, crosshatch, or ink modes",
    heavy: true,
    controls: [
      {
        kind: "select",
        key: "mode",
        label: "Mode",
        options: [
          { value: "outline", label: "outline" },
          { value: "hatch", label: "hatch" },
          { value: "ink", label: "ink" },
        ],
        default: "outline",
      },
      { kind: "slider", key: "thickness", label: "Thickness", min: 1, max: 4, step: 0.1, default: 1.5, unit: true },
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: "slider", key: "wiggle", label: "Wiggle", min: 0, max: 1, step: 0.01, default: 0 },
      { kind: "slider", key: "hatchSpacing", label: "Hatch spacing", min: 4, max: 16, step: 1, default: 8, unit: true },
      { kind: "color", key: "ink", label: "Ink", default: "#16140f" },
      { kind: "color", key: "paper", label: "Paper", default: "#f1ece4" },
    ],
  },
  kuwahara: {
    type: "kuwahara",
    category: "converter",
    label: "Kuwahara",
    blurb: "Edge-preserving oil-paint filter",
    heavy: true,
    controls: [
      {
        kind: "select",
        key: "quality",
        label: "Quality",
        options: [
          { value: "fast", label: "fast" },
          { value: "smooth", label: "smooth" },
        ],
        // smooth is the better look and costs the same on the GL pass
        // (0.083 ms/frame); the CPU engine only pays it on still export
        default: "smooth",
      },
      { kind: "slider", key: "radius", label: "Radius", min: 2, max: 12, step: 1, default: 4, unit: true },
    ],
  },

  // -------------------------------------------------- post parity
  crtCurvature: {
    type: "crtCurvature",
    category: "post",
    label: "CRT curvature",
    blurb: "Barrel-distortion screen warp + edge falloff",
    heavy: true,
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.25 },
      { kind: "slider", key: "edge", label: "Edge falloff", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
  },
  glitch: {
    type: "glitch",
    category: "post",
    label: "Glitch",
    blurb: "Block displacement + channel shift (animatable)",
    heavy: true,
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.4 },
      { kind: "slider", key: "bands", label: "Bands", min: 4, max: 48, step: 1, default: 18 },
      { kind: "switch", key: "animate", label: "Animate", default: true },
    ],
  },
  filmDust: {
    type: "filmDust",
    category: "post",
    label: "Film dust",
    blurb: "Sparse specks + scratches (animatable)",
    controls: [
      { kind: "slider", key: "amount", label: "Amount", min: 0, max: 1, step: 0.01, default: 0.3 },
      { kind: "switch", key: "animate", label: "Animate", default: true },
    ],
  },
  characterBloom: {
    type: "characterBloom",
    category: "post",
    label: "Character bloom",
    blurb: "Glow the bright strokes of a glyph render",
    heavy: true,
    controls: [
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.55 },
      { kind: "slider", key: "intensity", label: "Intensity", min: 0, max: 1.5, step: 0.01, default: 0.7 },
      { kind: "slider", key: "radius", label: "Radius", min: 0, max: 40, step: 0.5, default: 6, unit: true },
    ],
  },
};

// Add-effect menu order (grouped loosely: tone → structure → color → stylize → post).
export const EFFECT_ORDER: EffectType[] = [
  // converters / styles
  "ascii",
  "blockChars",
  "mixed",
  "crosshatch",
  "diagonal",
  "diamond",
  "lines",
  "glyphDots",
  "braille",
  "mosaic",
  "lego",
  "pixelate",
  "dither",
  "halftone",
  "lineArt",
  "kuwahara",
  // tone
  "adjust",
  "blur",
  "sharpen",
  "posterize",
  "threshold",
  "grayscale",
  // color
  "gradientMap",
  "tint",
  // post
  "chromatic",
  "displace",
  "bloom",
  "characterBloom",
  "scanlines",
  "crtCurvature",
  "glitch",
  "grain",
  "filmDust",
  "vignette",
];

function cloneStops(stops: GradientStop[]): GradientStop[] {
  return stops.map((s) => ({ ...s }));
}

/** default value for one control */
export function controlDefault(spec: ControlSpec): ParamValue {
  if (spec.kind === "gradient") return cloneStops(spec.default);
  return spec.default;
}

/** fully-defaulted params object for an effect type */
export function defaultParams(type: EffectType): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const c of EFFECT_CATALOG[type].controls) out[c.key] = controlDefault(c);
  return out;
}
