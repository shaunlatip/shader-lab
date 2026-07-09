// BG Lab — pattern-source catalog. Same role as catalog.ts but for the pattern
// generator: ONE source of truth for the pattern control rows (PatternPanel),
// schema clamp/validation of pasted pattern configs, and the default state.
// Lives in lib/ (not components/) so schema.ts can import it.

import type { ControlSpec } from "./catalog";
import { PATTERN_TYPES, type PatternState, type PatternType } from "./types";

// Leuchtturm-notebook dot grid: small pale-gray dots on off-white paper —
// the physical ideal for a dot grid, and a light default (dark patterns were
// the odd one out; most real-world uses are paper-light). Stored patterns in
// existing configs carry their own values and are unaffected.
export const DEFAULT_PATTERN: PatternState = {
  type: "dotGrid",
  cell: 28,
  weight: 0.12,
  thickness: 1.5,
  opacity: 1,
  jitter: 0,
  angle: 0,
  stagger: false,
  fg: "#b9b6b0",
  bg: "#f5f4f1",
};

export const PATTERN_TYPE_LABEL: Record<PatternType, string> = {
  dotGrid: "Dot grid",
  lineGrid: "Line grid",
  graph: "Graph paper",
  plusGrid: "Plus grid",
  xGrid: "X grid",
  cuttingMat: "Cutting mat",
  halftoneGradient: "Halftone ramp",
  checker: "Checker",
  stripes: "Stripes",
  waves: "Waves",
  rings: "Rings",
  iso: "Iso lattice",
  moire: "Moiré",
  hex: "Hex grid",
  truchet: "Truchet",
  voronoi: "Voronoi",
  fbm: "Noise (fbm)",
  clouds: "Clouds",
  sky: "Sky",
  caustics: "Caustics",
};

export const PATTERN_TYPE_OPTIONS: { value: PatternType; label: string }[] = PATTERN_TYPES.map((t) => ({
  value: t,
  label: PATTERN_TYPE_LABEL[t],
}));

export const PATTERN_CONTROLS: ControlSpec[] = [
  {
    kind: "select",
    key: "type",
    label: "Type",
    options: PATTERN_TYPE_OPTIONS,
    default: "dotGrid",
  },
  {
    kind: "slider",
    key: "cell",
    label: "Cell size",
    min: 4,
    max: 200,
    step: 1,
    default: DEFAULT_PATTERN.cell,
    unit: true,
  },
  {
    kind: "slider",
    key: "weight",
    label: "Weight",
    // Floor down near zero — every draw already clamps stroke/dot size to a
    // 1px minimum, so raising the slider's own floor just made a true
    // hairline unreachable at larger cell sizes. Retained for the fill/field
    // patterns (halftone ramp, generative softness); stroke/mark patterns use
    // `thickness` instead.
    min: 0.01,
    max: 0.95,
    step: 0.005,
    default: DEFAULT_PATTERN.weight,
  },
  {
    kind: "slider",
    key: "thickness",
    label: "Thickness",
    // Absolute px stroke/mark width (Matte parity). Fixed in pixels so marks
    // don't fatten as spacing widens — the key mismatch vs Matte.
    min: 0.5,
    max: 10,
    step: 0.5,
    default: DEFAULT_PATTERN.thickness,
    unit: true,
  },
  {
    kind: "slider",
    key: "opacity",
    label: "Opacity",
    min: 0,
    max: 1,
    step: 0.01,
    default: DEFAULT_PATTERN.opacity,
  },
  {
    kind: "slider",
    key: "jitter",
    label: "Jitter",
    min: 0,
    max: 0.5,
    step: 0.01,
    default: DEFAULT_PATTERN.jitter,
  },
  {
    kind: "slider",
    key: "angle",
    label: "Angle",
    min: -180,
    max: 180,
    step: 1,
    default: DEFAULT_PATTERN.angle,
  },
  {
    kind: "switch",
    key: "stagger",
    label: "Stagger rows",
    default: DEFAULT_PATTERN.stagger,
  },
  {
    kind: "color",
    key: "fg",
    label: "Foreground",
    default: DEFAULT_PATTERN.fg,
  },
  {
    kind: "color",
    key: "bg",
    label: "Background",
    default: DEFAULT_PATTERN.bg,
  },
];
