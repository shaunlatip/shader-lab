// BG Lab — core data model. This is the single source of truth for the editor
// state AND the copy-paste "AI config" JSON shape (a pasted BgConfig round-trips
// to identity), so keep it serialization-clean (no functions, no class instances).

export interface GradientStop {
  /** position along luminance 0..1 */
  t: number;
  /** #rrggbb */
  color: string;
}

export type ParamValue = number | string | boolean | GradientStop[];

export type EffectType =
  | "adjust"
  | "blur"
  | "pixelate"
  | "posterize"
  | "dither"
  | "halftone"
  | "gradientMap"
  | "threshold"
  | "grayscale"
  | "grain"
  | "tint"
  | "chromatic"
  | "scanlines"
  | "vignette"
  | "bloom"
  | "sharpen"
  | "displace"
  | "lightRays"
  // converters / styles
  | "ascii"
  | "blockChars"
  | "crosshatch"
  | "diagonal"
  | "diamond"
  | "lines"
  | "mixed"
  | "glyphDots"
  | "braille"
  | "mosaic"
  | "lego"
  | "receipt"
  | "flutedGlass"
  | "ledPanel"
  | "crochet"
  // post parity (Phase 4)
  | "crtCurvature"
  | "glitch"
  | "filmDust"
  | "characterBloom"
  // converters (Phase 5)
  | "lineArt"
  | "kuwahara"
  // surface treatments (Editions: light + paper)
  | "lightLeak"
  | "gobo"
  | "caustic"
  | "relief"
  | "stain";

export interface Effect {
  /** stable nanoid — drives dnd + React keys, never the array index */
  id: string;
  /** null = blank row from "Add", awaiting a combobox pick; render skips it */
  type: EffectType | null;
  enabled: boolean;
  params: Record<string, ParamValue>;
}

export type AspectId = "3:2" | "4:3" | "16:9" | "21:9" | "1:1" | "2:3" | "9:16";

/** Source crop/rotate, applied in the engine base draw (before the stack).
 * `crop` is normalized 0..1 in the rotated source's space. */
export interface SourceTransform {
  rotate?: 0 | 90 | 180 | 270;
  flipH?: boolean;
  crop?: { x: number; y: number; w: number; h: number };
}

/** Runtime list so schema validation can check pasted pattern types — a const
 * array of literals keeps this file serialization-clean. */
export const PATTERN_TYPES = [
  "dotGrid",
  "lineGrid",
  "graph",
  "checker",
  "stripes",
  "waves",
  "rings",
  "iso",
  "plusGrid",
  "xGrid",
  "cuttingMat",
  "halftoneGradient",
  "moire",
  "hex",
  "truchet",
  "voronoi",
  "fbm",
  "clouds",
  "sky",
  "caustics",
] as const;

export type PatternType = (typeof PATTERN_TYPES)[number];

export interface PatternState {
  type: PatternType;
  /** Spacing in px (the "Cell size" / "Spacing" slider). */
  cell: number;
  /** Legacy 0..1 size fraction — kept for the fill/field patterns (halftone
   * ramp, generative softness) and back-compat with saved patterns. Stroke/mark
   * patterns use `thickness` (absolute px) instead, matching Matte. */
  weight: number;
  /** Absolute stroke/mark width in px (Matte-parity "Thickness"). */
  thickness: number;
  /** Mark opacity 0..1 over the background (Matte-parity "Opacity"). */
  opacity: number;
  jitter: number;
  angle: number;
  stagger: boolean;
  fg: string;
  bg: string;
}

/** Continuous-field gradient source. Its own `source.mode` (not a PatternState
 * type) because it carries N stops + geometry PatternState's fg/bg can't hold.
 * RULE for future sources: mark/tiling pattern → a PatternType; continuous field
 * with its own parameter shape → its own source.mode. Stops interpolate in OKLCH. */
export type GradientType = "linear" | "radial" | "conic" | "mesh" | "warp" | "reaction";

export interface GradientState {
  type: GradientType;
  /** degrees — linear: ramp direction; conic: start angle; warp: flow direction */
  angle: number;
  /** center X 0..1 (radial / conic; ignored by linear) */
  cx: number;
  /** center Y 0..1 (radial / conic; ignored by linear) */
  cy: number;
  /** radial radius as a fraction of the canvas diagonal 0..1 (radial only) */
  radius: number;
  /** 2..5 color stops, positioned 0..1, interpolated in OKLCH; the warp field
   * is colored through this ramp too (all types except mesh) */
  stops: GradientStop[];
  /** 4 corner colors [TL, TR, BR, BL], bilinearly blended in OKLab (mesh only) */
  mesh?: string[];
  /** domain-warp feature scale — number of tiles across the canvas (warp only) */
  scale?: number;
  /** domain-warp strength — Quilez nested-fbm displacement (warp only) */
  warp?: number;
  /** noise seed (warp only) */
  seed?: number;
  /** wrap the noise domain so the tile is seamless (warp only) */
  seamless?: boolean;
  /** Gray-Scott feed rate (reaction only) */
  feed?: number;
  /** Gray-Scott kill rate (reaction only) */
  kill?: number;
}

export interface SourceState {
  mode: "image" | "video" | "solid" | "pattern" | "gradient";
  /** gallery id | "upload" | `pexels:<url>` | `pexels:video:<url>` | blob/data URL | null */
  imageId: string | null;
  /** #rrggbb */
  solidColor: string;
  /** optional crop + rotate applied to the source */
  transform?: SourceTransform;
  /** pattern generator state — only used when mode === "pattern" */
  pattern?: PatternState;
  /** gradient generator state — only used when mode === "gradient" */
  gradient?: GradientState;
}

export interface OutputState {
  aspect: AspectId | { w: number; h: number };
  /** long-edge px for export */
  longEdge: number;
}

export interface BgConfig {
  version: 1;
  output: OutputState;
  source: SourceState;
  /** ORDER IS SEMANTIC — the render loop walks this array top → bottom */
  stack: Effect[];
}

export interface Dims {
  W: number;
  H: number;
}
