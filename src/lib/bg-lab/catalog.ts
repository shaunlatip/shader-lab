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
  /** Param exists (defaults, clamp, AI schema, engine) but renders no row.
   * Used to keep param keys stable while removing an effect-identity knob
   * from the UI (e.g. the glyph string on shape styles — users don't think
   * of "Crosshatch" as characters). NEVER delete a key; hide it. */
  hidden?: boolean;
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
  /** Per-effect override for group headers — shape styles rename
   * "Characters" to what the marks actually are ("Strokes", "Dots"). */
  groupLabels?: Partial<Record<ControlGroup, string>>;
  controls: ControlSpec[];
}

const BLENDS = ["soft-light", "overlay", "multiply", "screen"].map((v) => ({
  value: v,
  label: v,
}));

// Shared controls for the glyph family, split into two control surfaces:
//   family "ramp"  — ASCII / block / mixed. Users think in characters, so the
//                    character set and glyph string stay front and center.
//   family "shape" — crosshatch / diagonal / diamond / lines / dots. Users
//                    think in marks (strokes, dots), not characters: the glyph
//                    machinery is hidden (params kept — see rules below) and
//                    the group header is renamed per effect via groupLabels.
//
// SAFETY RULES for editing this catalog (persisted configs depend on it):
//   1. NEVER rename or delete a param key — set `hidden: true` instead.
//      Saved sets/drafts snapshot full param objects; clampParams drops
//      unknown keys on the AI-paste path.
//   2. Changing a `default` only affects newly-added effects (snapshots are
//      full), so defaults are safe to evolve.
//   3. Any NEW key needs a behavior-neutral fallback in the CPU op and a
//      matching GL uniform default, so pre-existing stacks render unchanged.
function glyphControls(o: {
  cell: number;
  glyphs: string;
  colorMode: "ink" | "source";
  sizeByBrightness: boolean;
  family: "ramp" | "shape";
}): ControlSpec[] {
  const shape = o.family === "shape";
  return [
    // --- Characters / Marks: the mark look ---
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
      // Shape styles: the glyph IS the effect's identity — not a user knob.
      hidden: shape,
    },
    // Raw glyph string only when the user picks "custom" — otherwise the preset
    // (or this style's built-in set) drives it. Folds two rows into one.
    { kind: "text", group: "characters", key: "glyphs", label: "Glyphs", default: o.glyphs, maxLen: 64, showIf: { key: "charSet", in: ["custom"] }, hidden: shape },
    // Scale of the mark within its cell. Promoted out of Advanced: it changes
    // the whole texture of the render and is the knob people reach for first.
    { kind: "slider", group: "characters", key: "fontScale", label: o.family === "shape" ? "Mark scale" : "Font scale", min: 0.3, max: 2, step: 0.05, default: 1 },
    {
      kind: "select",
      group: "characters",
      key: "colorMode",
      label: "Color",
      options: [
        { value: "source", label: "from image" },
        { value: "ink", label: "solid ink" },
      ],
      default: o.colorMode,
    },
    // Ink/paper defaults carry each family's physical identity — AND drive the
    // ramp polarity (renderGlyph densifies toward whichever of ink/paper is
    // brighter). Ramp styles are terminal art: light ink, dark paper, dense
    // glyphs in highlights (ascii-magic). Shape styles are prints: dark ink,
    // light paper, dense marks in shadow.
    { kind: "color", group: "characters", key: "ink", label: "Ink", default: shape ? "#1a1713" : "#e9e4d8", showIf: { key: "colorMode", in: ["ink"] } },
    { kind: "slider", group: "characters", key: "charOpacity", label: "Opacity", min: 0, max: 1, step: 0.01, default: 1 },
    { kind: "switch", group: "characters", key: "invert", label: "Invert", default: false },

    // --- Intensity: how the image maps onto the grid ---
    // Auto contrast: percentile histogram stretch of the cell-luma grid so any
    // source uses the full glyph ramp (low-contrast photos otherwise cluster in
    // 2–3 ramp steps and read flat — the single biggest ascii-magic-parity
    // lever). New param: op fallback is false so old stacks are untouched.
    { kind: "switch", group: "intensity", key: "autoContrast", label: "Auto contrast", default: true },
    { kind: "slider", group: "intensity", key: "coverage", label: "Coverage", min: 0, max: 1, step: 0.01, default: 1 },
    { kind: "slider", group: "intensity", key: "density", label: "Density", min: 0.5, max: 1.8, step: 0.05, default: 1 },
    { kind: "slider", group: "intensity", key: "edgeEmphasis", label: "Edge emphasis", min: 0, max: 1, step: 0.01, default: 0 },
    { kind: "slider", group: "intensity", key: "brightness", label: "Brightness", min: -1, max: 1, step: 0.01, default: 0 },
    { kind: "slider", group: "intensity", key: "contrast", label: "Contrast", min: 0.3, max: 2.5, step: 0.05, default: 1 },

    // --- Background: what sits behind the marks ---
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
      // Both families default to flat paper — glyphs/marks drawn in source
      // color over the source image (even blurred) camouflage into it and read
      // as nearly invisible; verified side-by-side in the defaults audit.
      // Ramp styles sit on dark terminal paper (ascii-magic: bright glyphs on
      // black), shape styles on light print paper (ink on paper).
      default: "paper",
    },
    { kind: "slider", group: "background", key: "bgBlur", label: "Blur", min: 0, max: 40, step: 0.5, default: 8, unit: true, showIf: { key: "background", in: ["blurred"] } },
    // Physical-media default for shape styles: light paper, dark marks —
    // prints are ink on paper, not glow on a void. Ramp styles keep the dark
    // terminal paper (their background defaults to the blurred image anyway).
    // Existing configs carry their own snapshots and are unaffected.
    { kind: "color", group: "background", key: "paper", label: "Paper", default: shape ? "#f1ece4" : "#16140f", showIf: { key: "background", in: ["paper"] } },

    // --- Advanced: rarely touched / style-identity knobs ---
    {
      kind: "select",
      group: "advanced",
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
    { kind: "switch", group: "advanced", key: "dotGrid", label: "Dot grid", default: false },
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
      // Progressive depixelation (Heckel C9): block halves per step and loops.
      { kind: "switch", key: "animate", label: "Animate", default: false },
      { kind: "slider", key: "speed", label: "Speed", min: 0.25, max: 4, step: 0.25, default: 1, showIf: { key: "animate", in: [true] } },
      { kind: "slider", key: "steps", label: "Steps", min: 2, max: 7, step: 1, default: 5, showIf: { key: "animate", in: [true] } },
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
      // Animated blue-noise scroll (golden-ratio rank rotation). blueNoise only:
      // Bayer/stripes have no meaningful temporal ordering, diffusion has no matrix.
      { kind: "switch", key: "animate", label: "Animate", default: false, showIf: { key: "type", in: ["blueNoise"] } },
      { kind: "slider", key: "speed", label: "Speed", min: 0.25, max: 4, step: 0.25, default: 1, showIf: { key: "type", in: ["blueNoise"] } },
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
      {
        kind: "select",
        key: "quality",
        label: "Quality",
        options: [
          { value: "gaussian", label: "gaussian" },
          { value: "dual", label: "dual filter" },
        ],
        // dual = mip-chain dual filter (GL preview look authority; still
        // export renders the gaussian equivalent — accepted divergence,
        // same class as the blur family's Skia-vs-true-gaussian shape).
        default: "gaussian",
      },
    ],
  },
  lightRays: {
    type: "lightRays",
    category: "post",
    label: "Light rays",
    blurb: "Crepuscular rays from a light position over bright areas",
    heavy: true,
    controls: [
      { kind: "slider", key: "x", label: "Light X", min: 0, max: 100, step: 1, default: 50 },
      { kind: "slider", key: "y", label: "Light Y", min: 0, max: 100, step: 1, default: 25 },
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.6 },
      { kind: "slider", key: "samples", label: "Quality", min: 8, max: 64, step: 4, default: 32 },
      { kind: "slider", key: "density", label: "Length", min: 0.1, max: 1, step: 0.01, default: 0.8 },
      { kind: "slider", key: "decay", label: "Decay", min: 0.8, max: 1, step: 0.005, default: 0.95 },
      { kind: "slider", key: "strength", label: "Strength", min: 0, max: 2, step: 0.01, default: 0.7 },
      { kind: "color", key: "color", label: "Tint", default: "#ffe3b8" },
      {
        kind: "select",
        key: "blend",
        label: "Blend",
        options: [
          { value: "screen", label: "screen" },
          { value: "add", label: "add" },
        ],
        default: "screen",
      },
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
    controls: glyphControls({ cell: 10, glyphs: "@#S08Xx+=-;:,. ", colorMode: "source", sizeByBrightness: false, family: "ramp" }),
  },
  blockChars: {
    type: "blockChars",
    category: "converter",
    label: "Block chars",
    blurb: "Unicode block glyphs — dense terminal aesthetic",
    heavy: true,
    controls: glyphControls({ cell: 9, glyphs: "█▓▒░ ", colorMode: "source", sizeByBrightness: false, family: "ramp" }),
  },
  mixed: {
    type: "mixed",
    category: "converter",
    label: "Mixed glyphs",
    blurb: "Rich multi-glyph ramp, sampled in source color",
    heavy: true,
    controls: glyphControls({ cell: 11, glyphs: "@#WM&8B%$Xx+=-:. ", colorMode: "source", sizeByBrightness: false, family: "ramp" }),
  },
  crosshatch: {
    type: "crosshatch",
    category: "converter",
    label: "Crosshatch",
    blurb: "Woven ✕ strokes sized by darkness",
    heavy: true,
    groupLabels: { characters: "Strokes" },
    controls: glyphControls({ cell: 10, glyphs: "╳", colorMode: "source", sizeByBrightness: true, family: "shape" }),
  },
  diagonal: {
    type: "diagonal",
    category: "converter",
    label: "Diagonal hatch",
    blurb: "Slanted strokes — engraved texture",
    heavy: true,
    groupLabels: { characters: "Strokes" },
    controls: glyphControls({ cell: 10, glyphs: "╱", colorMode: "source", sizeByBrightness: true, family: "shape" }),
  },
  diamond: {
    type: "diamond",
    category: "converter",
    label: "Diamonds",
    blurb: "Jewel-like ◆ marks, brightness-sized",
    heavy: true,
    groupLabels: { characters: "Marks" },
    controls: glyphControls({ cell: 12, glyphs: "◆", colorMode: "source", sizeByBrightness: true, family: "shape" }),
  },
  lines: {
    type: "lines",
    category: "converter",
    label: "Vertical lines",
    blurb: "Rain / barcode strokes — minimal, graphic",
    heavy: true,
    groupLabels: { characters: "Strokes" },
    controls: glyphControls({ cell: 8, glyphs: "│", colorMode: "source", sizeByBrightness: true, family: "shape" }),
  },
  glyphDots: {
    type: "glyphDots",
    category: "converter",
    label: "Dots",
    blurb: "Halftone-print circles scaled by brightness",
    heavy: true,
    groupLabels: { characters: "Dots" },
    controls: glyphControls({ cell: 10, glyphs: "●", colorMode: "source", sizeByBrightness: true, family: "shape" }),
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
      // Error diffusion across the dot lattice (Floyd–Steinberg, serpentine)
      // instead of a hard threshold — braille embossers dither for tone.
      // New param: op fallback is false so old stacks are untouched.
      { kind: "switch", group: "characters", key: "dither", label: "Dither", default: true },
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
        // Flat dark paper, same rationale as the glyph family: dots over the
        // source image camouflage into it.
        default: "paper",
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
  receipt: {
    type: "receipt",
    category: "converter",
    label: "Receipt print",
    blurb: "Thermal-printer scanline bars",
    controls: [
      { kind: "slider", key: "size", label: "Band size", min: 2, max: 16, step: 1, default: 5, unit: true },
      { kind: "slider", key: "contrast", label: "Contrast", min: 0.5, max: 3, step: 0.05, default: 1.2 },
      { kind: "color", key: "ink", label: "Ink", default: "#1a1a1a" },
      { kind: "color", key: "paper", label: "Paper", default: "#f6f3ea" },
    ],
  },
  flutedGlass: {
    type: "flutedGlass",
    category: "converter",
    label: "Fluted glass",
    blurb: "Vertical reeded-glass refraction with rib highlights",
    controls: [
      { kind: "slider", key: "size", label: "Rib width", min: 4, max: 64, step: 1, default: 18, unit: true },
      { kind: "slider", key: "amount", label: "Refraction", min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: "slider", key: "specular", label: "Specular", min: 0, max: 1, step: 0.01, default: 0.35 },
    ],
  },
  ledPanel: {
    type: "ledPanel",
    category: "converter",
    label: "LED panel",
    blurb: "RGB sub-pixel LED matrix with bezel grid",
    controls: [
      { kind: "slider", key: "size", label: "Cell size", min: 6, max: 48, step: 1, default: 14, unit: true },
      { kind: "slider", key: "gap", label: "Bezel gap", min: 0, max: 0.45, step: 0.01, default: 0.18 },
      { kind: "switch", key: "stagger", label: "Stagger", default: false },
      { kind: "slider", key: "glow", label: "Glow", min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
  },
  crochet: {
    type: "crochet",
    category: "converter",
    label: "Crochet",
    blurb: "Yarn V-stitches over fabric rows",
    controls: [
      { kind: "slider", key: "size", label: "Stitch size", min: 8, max: 48, step: 1, default: 18, unit: true },
      { kind: "slider", key: "yarnWidth", label: "Yarn width", min: 0.1, max: 0.5, step: 0.01, default: 0.3 },
      { kind: "color", key: "paper", label: "Fabric", default: "#2a2320" },
    ],
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
          { value: "xdog", label: "XDoG" },
        ],
        default: "outline",
      },
      { kind: "slider", key: "thickness", label: "Thickness", min: 1, max: 4, step: 0.1, default: 1.5, unit: true },
      // Reused by xdog mode as epsilon = threshold * 0.1 (default 0.5 -> eps 0.05).
      { kind: "slider", key: "threshold", label: "Threshold", min: 0, max: 1, step: 0.01, default: 0.5 },
      { kind: "slider", key: "wiggle", label: "Wiggle", min: 0, max: 1, step: 0.01, default: 0 },
      { kind: "slider", key: "hatchSpacing", label: "Hatch spacing", min: 4, max: 16, step: 1, default: 8, unit: true },
      // xdog-only params: gaussian sigma (unit-scaled) and the tanh soft-knee gain (phi).
      { kind: "slider", key: "sigma", label: "XDoG sigma", min: 0.5, max: 8, step: 0.1, default: 2, unit: true },
      { kind: "slider", key: "edgeSoftness", label: "XDoG edge softness", min: 1, max: 40, step: 0.5, default: 10 },
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
          { value: "anisotropic", label: "anisotropic" },
        ],
        // smooth is the better look and costs the same on the GL pass
        // (0.083 ms/frame); the CPU engine only pays it on still export.
        // anisotropic (Kyprianidis) aligns strokes to image flow — the
        // "painted" look; radius caps at 8 in that mode (ellipse reach 2R).
        default: "smooth",
      },
      { kind: "slider", key: "radius", label: "Radius", min: 2, max: 12, step: 1, default: 4, unit: true },
      { kind: "slider", key: "anisotropy", label: "Stroke elongation", min: 0.25, max: 2, step: 0.05, default: 1, showIf: { key: "quality", in: ["anisotropic"] } },
      { kind: "slider", key: "sharpness", label: "Sector sharpness", min: 2, max: 16, step: 1, default: 8, showIf: { key: "quality", in: ["anisotropic"] } },
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
  "receipt",
  "flutedGlass",
  "ledPanel",
  "crochet",
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
  "lightRays",
  "characterBloom",
  "scanlines",
  "crtCurvature",
  "glitch",
  "grain",
  "filmDust",
  "vignette",
];

// Dev-only sanity: EFFECT_ORDER must be a duplicate-free permutation of the
// catalog keys — a missed entry silently hides an effect from the add menu.
if (process.env.NODE_ENV !== "production") {
  const order = new Set(EFFECT_ORDER);
  if (order.size !== EFFECT_ORDER.length) throw new Error("EFFECT_ORDER contains duplicates");
  for (const type of Object.keys(EFFECT_CATALOG)) {
    if (!order.has(type as EffectType)) throw new Error(`EFFECT_ORDER is missing "${type}"`);
  }
}

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
