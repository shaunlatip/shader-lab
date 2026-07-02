// BG Lab — the engine boundary. UI/export/zoom touch ONLY this interface, never
// a concrete engine, so a WebGL engine can drop in later without touching anything
// above this line.

import type { BgConfig, Dims, PatternState } from "../types";

export type EngineSource =
  | { kind: "image"; image: CanvasImageSource & { width?: number; height?: number } }
  | { kind: "video"; video: HTMLVideoElement }
  | { kind: "solid"; color: string }
  | { kind: "pattern"; pattern: PatternState }
  | null;

export interface RenderEngine {
  setSource(src: EngineSource): void;
  /** re-run the whole stack at `dims` into `target` (preview or export).
   * `time` (seconds) drives animated effects; omit for a static still. */
  render(target: HTMLCanvasElement, config: BgConfig, dims: Dims, time?: number): void;
  dispose(): void;
}
