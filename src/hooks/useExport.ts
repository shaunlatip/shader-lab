import { useRef, useState } from "react";
import { createEngine, type EngineSource, type RenderEngine } from "@/lib/bg-lab/engine";
import { MAX_EXPORT_PIXELS, outputDims, totalPixels } from "@/lib/bg-lab/resolution";
import { createGifEncoder, createMp4Encoder, supportsMp4 } from "@/lib/bg-lab/export/encoders";
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

  function exportStill(
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
    try {
      const canvas = document.createElement("canvas");
      const engine = cpu();
      engine.setSource(engineSource);
      engine.render(canvas, config, dims);
      const mime = format === "jpg" ? "image/jpeg" : "image/png";
      canvas.toBlob(
        (blob) => {
          setExporting(false);
          if (!blob) {
            cb?.onError?.("Export failed (the image may be cross-origin and untainted-only).");
            return;
          }
          const name = `background-${dims.W}x${dims.H}.${format}`;
          download(blob, name);
          cb?.onDone?.(name);
        },
        mime,
        format === "jpg" ? 0.92 : undefined,
      );
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
        engine.setSource(engineSource);
        try {
          engine.render(canvas, config, dims, t);
        } catch {
          // GL failed (e.g. context loss / dims) — fall back to CPU for the rest
          engine = cpu();
          engine.setSource(engineSource);
          engine.render(canvas, config, dims, t);
        }
        enc.addFrame(canvas);
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
