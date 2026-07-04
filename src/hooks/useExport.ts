import { useRef, useState } from "react";
import { createEngine, type EngineSource, type RenderEngine } from "@/lib/bg-lab/engine";
import { MAX_EXPORT_PIXELS, outputDims, totalPixels } from "@/lib/bg-lab/resolution";
import { createGifEncoder, createMp4Encoder, supportsMp4 } from "@/lib/bg-lab/export/encoders";
import type { StillJob, StillResult } from "@/lib/bg-lab/export/stillWorker";
import type { BgConfig, Dims } from "@/lib/bg-lab/types";

export type StillFormat = "png" | "jpg";
export type ClipFormat = "mp4" | "gif";

interface ExportCallbacks {
  onError?: (msg: string) => void;
  onDone?: (name: string) => void;
}

const MAX_CLIP_SECONDS = 30;
const VIDEO_MAX_LONG = 1920; // keep H.264 within Main@L4.0

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Yield a macrotask so React can flush state (spinner/progress) and the
 * browser can paint before the next synchronous render/encode block. */
const yieldToUI = () => new Promise<void>((res) => setTimeout(res, 0));

// --- still-export worker (module-level: reused across exports; one job at a
// time — useExport serializes on its `exporting` flag). The full-res CPU
// render runs off the main thread so huge exports don't freeze the UI.
let stillWorker: Worker | null = null;

function decomposeSource(src: EngineSource): Promise<Pick<StillJob, "image" | "solid" | "pattern">> {
  if (src?.kind === "image") return createImageBitmap(src.image).then((image) => ({ image }));
  // A video still exports its current frame (same as the sync path's drawImage)
  if (src?.kind === "video") return createImageBitmap(src.video).then((image) => ({ image }));
  if (src?.kind === "pattern") return Promise.resolve({ pattern: src.pattern });
  return Promise.resolve({ solid: src?.kind === "solid" ? src.color : undefined });
}

function renderStillInWorker(config: BgConfig, dims: Dims, source: EngineSource, mime: string, quality?: number): Promise<Blob> {
  return decomposeSource(source).then(
    (parts) =>
      new Promise<Blob>((resolve, reject) => {
        stillWorker ??= new Worker(new URL("../lib/bg-lab/export/stillWorker.ts", import.meta.url));
        const worker = stillWorker;
        const job: StillJob = { config, dims, mime, quality, ...parts };
        worker.onmessage = (ev: MessageEvent<StillResult>) => {
          if (ev.data.ok) resolve(ev.data.blob);
          else {
            const err = new Error(ev.data.error);
            if (ev.data.name) err.name = ev.data.name;
            reject(err);
          }
        };
        worker.onerror = (ev) => {
          // Worker failed to load/run (bundler or environment issue) — a fresh
          // one is created on the next attempt; caller falls back to sync.
          stillWorker = null;
          worker.terminate();
          reject(new Error(ev.message || "still-export worker failed"));
        };
        worker.postMessage(job, parts.image ? [parts.image] : []);
      }),
  );
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.min(t, Math.max(0, (video.duration || 0) - 0.001));
  // Assigning currentTime to its current value fires no "seeked" event — resolve
  // immediately so the export loop can't hang.
  if (Math.abs(video.currentTime - target) < 1e-3) return Promise.resolve();
  return new Promise((res) => {
    let to = 0;
    const done = () => {
      video.removeEventListener("seeked", done);
      clearTimeout(to);
      res();
    };
    video.addEventListener("seeked", done);
    to = window.setTimeout(done, 2000); // fallback: never hang on a missing event
    video.currentTime = target;
  });
}

export function useExport() {
  const cpuRef = useRef<RenderEngine | null>(null);
  const glRef = useRef<RenderEngine | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const cpu = () => (cpuRef.current ??= createEngine("cpu"));
  const gl = () => (glRef.current ??= createEngine("gl"));

  async function exportStill(
    config: BgConfig,
    engineSource: EngineSource,
    opts: { format?: StillFormat; scale?: number } = {},
    cb?: ExportCallbacks,
  ) {
    const format = opts.format ?? "png";
    const scale = opts.scale ?? 1;
    const dims = outputDims(config.output.aspect, config.output.longEdge * scale);
    if (totalPixels(dims) > MAX_EXPORT_PIXELS) {
      cb?.onError?.(
        `That's ${(totalPixels(dims) / 1e6).toFixed(0)} MP — over the ${(MAX_EXPORT_PIXELS / 1e6).toFixed(0)} MP cap. Lower the resolution or scale.`,
      );
      return;
    }
    setExporting(true);
    await yieldToUI();
    const mime = format === "jpg" ? "image/jpeg" : "image/png";
    const quality = format === "jpg" ? 0.92 : undefined;
    try {
      // ARCHITECTURE CONSTRAINT: still export uses the CPU engine — the CPU op is
      // the source of truth (GL is the preview accelerator). Don't switch this to
      // GL without pixel-parity guarantees (docs/effects-lab-handoff.md, F0).
      let blob: Blob;
      try {
        // Preferred: render in a worker (no main-thread freeze on big exports).
        blob = await renderStillInWorker(config, dims, engineSource, mime, quality);
      } catch (err) {
        // SecurityError = tainted source; the sync path fails identically, so
        // surface it. Anything else (no Worker/OffscreenCanvas, bundler issue)
        // falls back to the previous synchronous main-thread render.
        if (err instanceof Error && err.name === "SecurityError") throw err;
        const canvas = document.createElement("canvas");
        const engine = cpu();
        engine.setSource(engineSource);
        engine.render(canvas, config, dims);
        blob = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), mime, quality);
        });
      }
      setExporting(false);
      const name = `background-${dims.W}x${dims.H}.${format}`;
      download(blob, name);
      cb?.onDone?.(name);
    } catch (err) {
      setExporting(false);
      cb?.onError?.(
        err instanceof Error && err.name === "SecurityError"
          ? "This image can't be exported (cross-origin). Try uploading it instead."
          : "Export failed.",
      );
    }
  }

  async function exportClip(
    config: BgConfig,
    engineSource: EngineSource,
    opts: { format?: ClipFormat; fps?: number; start?: number; end?: number; scale?: number } = {},
    cb?: ExportCallbacks,
  ) {
    const format = opts.format ?? "mp4";
    if (format === "mp4" && !supportsMp4()) {
      cb?.onError?.("MP4 export needs WebCodecs (Chrome / Edge / Safari 16.4+). Try GIF.");
      return;
    }
    // Video source → seek real frames; otherwise export an animated still as a
    // short synthetic loop driven by the time clock.
    const video = engineSource && engineSource.kind === "video" ? engineSource.video : null;
    const LOOP_SECONDS = 3;
    const fps = opts.fps ?? (format === "gif" ? 12 : 30);
    const start = video ? Math.max(0, opts.start ?? 0) : 0;
    const end = video ? Math.min(video.duration || 0, opts.end ?? video.duration ?? 0) : LOOP_SECONDS;
    const dur = Math.min(MAX_CLIP_SECONDS, Math.max(0.1, video ? end - start : LOOP_SECONDS));
    const frames = Math.max(1, Math.round(dur * fps));

    // dims: cap the long edge for video, round even for H.264
    let dims: Dims = outputDims(config.output.aspect, Math.min(config.output.longEdge * (opts.scale ?? 1), VIDEO_MAX_LONG));
    dims = { W: dims.W - (dims.W % 2), H: dims.H - (dims.H % 2) };

    const wasPaused = video?.paused ?? true;
    video?.pause();
    setExporting(true);
    setProgress(0);
    let enc: ReturnType<typeof createGifEncoder> | null = null;
    try {
      let engine = gl();
      const canvas = document.createElement("canvas");
      enc = format === "gif" ? createGifEncoder(dims.W, dims.H, fps) : createMp4Encoder(dims.W, dims.H, fps);

      for (let i = 0; i < frames; i++) {
        const t = start + i / fps;
        if (video) await seek(video, t);
        // Without a real yield the whole loop runs as one task (seek can resolve
        // synchronously; GIF quantize + CPU renders are sync) — progress would
        // never paint until the export finishes.
        await yieldToUI();
        engine.setSource(engineSource);
        try {
          engine.render(canvas, config, dims, t);
        } catch {
          // GL failed (e.g. context loss / dims) — fall back to CPU for the rest
          engine = cpu();
          engine.setSource(engineSource);
          engine.render(canvas, config, dims, t);
        }
        await enc.addFrame(canvas);
        setProgress((i + 1) / frames);
      }
      const blob = await enc.finish();
      const name = `background-${dims.W}x${dims.H}.${enc.ext}`;
      download(blob, name);
      cb?.onDone?.(name);
    } catch (err) {
      enc?.dispose();
      cb?.onError?.(
        err instanceof Error && err.name === "SecurityError"
          ? "This clip can't be exported (cross-origin video). Try an uploaded file."
          : "Clip export failed.",
      );
    } finally {
      setExporting(false);
      setProgress(0);
      if (video && !wasPaused) video.play().catch(() => {});
    }
  }

  // back-compat alias
  const exportPng = (config: BgConfig, src: EngineSource, cb?: ExportCallbacks) => exportStill(config, src, {}, cb);

  return { exporting, progress, exportStill, exportClip, exportPng };
}
