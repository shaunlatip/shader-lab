// BG Lab — engine factory. Default is the WebGL2 engine; it falls back to the CPU
// engine when WebGL2 is unavailable or fails to initialise. Both implement the
// same RenderEngine interface, so nothing above this line cares which one runs.

import type { RenderEngine } from "./types";
import { CpuEngine } from "./cpu/cpuEngine";
import { GLEngine } from "./gl/glEngine";

export type EngineId = "cpu" | "gl";

/** Resolve the preferred engine from ?engine= or localStorage (QA / A-B override). */
export function preferredEngineId(): EngineId {
  if (typeof window === "undefined") return "gl";
  try {
    const q = new URLSearchParams(window.location.search).get("engine");
    if (q === "cpu" || q === "gl") return q;
    const ls = window.localStorage.getItem("bg-lab/engine");
    if (ls === "cpu" || ls === "gl") return ls;
  } catch {
    /* ignore */
  }
  return "gl";
}

export function createEngine(id: EngineId = "gl"): RenderEngine {
  if (id === "gl") {
    try {
      return new GLEngine();
    } catch {
      return new CpuEngine();
    }
  }
  return new CpuEngine();
}

export type { RenderEngine, EngineSource } from "./types";
