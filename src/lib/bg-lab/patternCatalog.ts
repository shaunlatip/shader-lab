// BG Lab — pattern-source catalog. Same role as catalog.ts but for the pattern
// generator: ONE source of truth for the pattern control rows (PatternPanel),
// schema clamp/validation of pasted pattern configs, and the default state.
// Lives in lib/ (not components/) so schema.ts can import it.

import type { ControlSpec } from "./catalog";
import { PATTERN_TYPES, type PatternState, type PatternType } from "./types";

export const DEFAULT_PATTERN: PatternState = {
  type: "dotGrid",
  cell: 24,
  weight: 0.3,
  jitter: 0,
  angle: 0,
  stagger: false,
  fg: "#e7e5e4",
  bg: "#16140f",
};

export const PATTERN_TYPE_LABEL: Record<PatternType, string> = {
  dotGrid: "Dot grid",
  lineGrid: "Line grid",
  checker: "Checker",
  stripes: "Stripes",
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
    max: 120,
    step: 1,
    default: DEFAULT_PATTERN.cell,
    unit: true,
  },
  {
    kind: "slider",
    key: "weight",
    label: "Weight",
    min: 0.05,
    max: 0.95,
    step: 0.01,
    default: DEFAULT_PATTERN.weight,
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
