// BG Lab — gradient-source catalog. Same role as patternCatalog.ts but for the
// gradient generator: ONE source of truth for the control rows (GradientPanel),
// schema clamp/validation of pasted gradient configs, and the default state.
// Lives in lib/ (not components/) so schema.ts can import it.

import type { ControlSpec } from "./catalog";
import type { GradientState, GradientType } from "./types";

// A calm dusk radial — the Summer '25 / sl-out-dusk register: a single-hue
// perceptual ramp that a light UI card reads cleanly against. Deliberately a
// two-stop OKLCH ramp so the midpoint stays luminous (the whole point of T1).
export const DEFAULT_GRADIENT: GradientState = {
  type: "radial",
  angle: 45,
  cx: 0.35,
  cy: 0.3,
  radius: 0.9,
  stops: [
    { t: 0, color: "#a56cf5" },
    { t: 1, color: "#7a3ad6" },
  ],
  mesh: ["#f0a6c8", "#a56cf5", "#3a2a6a", "#7a3ad6"],
  scale: 3,
  warp: 0.55,
  seed: 1,
  seamless: false,
  feed: 0.037,
  kill: 0.06,
};

/** Default 4-corner mesh colors [TL, TR, BR, BL] — a soft vaporwave field. */
export const DEFAULT_MESH = ["#f0a6c8", "#a56cf5", "#3a2a6a", "#7a3ad6"];

export const GRADIENT_TYPE_LABEL: Record<GradientType, string> = {
  linear: "Linear",
  radial: "Radial",
  conic: "Conic",
  mesh: "Mesh",
  warp: "Warp (dreamy)",
  reaction: "Reaction",
};

export const GRADIENT_TYPE_OPTIONS: { value: GradientType; label: string }[] = (
  ["linear", "radial", "conic", "mesh", "warp", "reaction"] as GradientType[]
).map((t) => ({ value: t, label: GRADIENT_TYPE_LABEL[t] }));

// `stops` is a gradient control; the rest are sliders/select. Schema + clamp
// walk this list, so a pasted gradient can never crash the render.
export const GRADIENT_CONTROLS: ControlSpec[] = [
  { kind: "select", key: "type", label: "Type", options: GRADIENT_TYPE_OPTIONS, default: "radial" },
  { kind: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: DEFAULT_GRADIENT.angle },
  { kind: "slider", key: "cx", label: "Center X", min: 0, max: 1, step: 0.01, default: DEFAULT_GRADIENT.cx },
  { kind: "slider", key: "cy", label: "Center Y", min: 0, max: 1, step: 0.01, default: DEFAULT_GRADIENT.cy },
  { kind: "slider", key: "radius", label: "Radius", min: 0.1, max: 1.5, step: 0.01, default: DEFAULT_GRADIENT.radius },
  { kind: "slider", key: "scale", label: "Scale", min: 1, max: 12, step: 0.5, default: DEFAULT_GRADIENT.scale ?? 3 },
  { kind: "slider", key: "warp", label: "Warp", min: 0, max: 1.5, step: 0.01, default: DEFAULT_GRADIENT.warp ?? 0.55 },
  { kind: "slider", key: "seed", label: "Seed", min: 1, max: 999, step: 1, default: DEFAULT_GRADIENT.seed ?? 1 },
  { kind: "switch", key: "seamless", label: "Seamless tile", default: false },
  { kind: "slider", key: "feed", label: "Feed", min: 0.01, max: 0.09, step: 0.001, default: DEFAULT_GRADIENT.feed ?? 0.037 },
  { kind: "slider", key: "kill", label: "Kill", min: 0.045, max: 0.07, step: 0.001, default: DEFAULT_GRADIENT.kill ?? 0.06 },
  { kind: "gradient", key: "stops", label: "Ramp", default: DEFAULT_GRADIENT.stops },
];
