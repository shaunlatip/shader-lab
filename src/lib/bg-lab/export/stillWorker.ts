// Still-export worker: runs the full-res CPU render off the main thread so
// large exports don't freeze the UI. The CPU engine is the export truth (F0) —
// this changes WHERE it runs, not WHAT it renders. Canvas allocation inside the
// engine falls back to OffscreenCanvas when there's no DOM (see util.tmpCanvas).
//
// The main thread decomposes EngineSource into structured-clone-safe parts:
// image/video become an ImageBitmap (transferred, closed here after render);
// solid/pattern travel as plain data. One job at a time (useExport already
// serializes on its `exporting` flag).

import { createEngine, type EngineSource } from "../engine";
import type { BgConfig, Dims, GradientState, PatternState } from "../types";

export interface StillJob {
  config: BgConfig;
  dims: Dims;
  mime: string;
  quality?: number;
  image?: ImageBitmap;
  solid?: string;
  pattern?: PatternState;
  gradient?: GradientState;
}

export type StillResult = { ok: true; blob: Blob } | { ok: false; error: string; name?: string };

// Typed view of the dedicated-worker global (tsconfig has no webworker lib;
// Window's postMessage signature differs, so cast once here).
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<StillJob>) => void) | null;
  postMessage: (msg: StillResult) => void;
};

scope.onmessage = async (ev: MessageEvent<StillJob>) => {
  const job = ev.data;
  try {
    const source: EngineSource = job.image
      ? { kind: "image", image: job.image }
      : job.pattern
        ? { kind: "pattern", pattern: job.pattern }
        : job.gradient
          ? { kind: "gradient", gradient: job.gradient }
          : { kind: "solid", color: job.solid ?? "#cdd9e0" };
    const canvas = new OffscreenCanvas(job.dims.W, job.dims.H);
    const engine = createEngine("cpu");
    try {
      engine.setSource(source);
      engine.render(canvas as unknown as HTMLCanvasElement, job.config, job.dims);
    } finally {
      engine.dispose();
      job.image?.close();
    }
    const blob = await canvas.convertToBlob({ type: job.mime, quality: job.quality });
    scope.postMessage({ ok: true, blob });
  } catch (err) {
    scope.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      name: err instanceof Error ? err.name : undefined,
    });
  }
};
