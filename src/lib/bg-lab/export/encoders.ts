// BG Lab — in-browser video/animation encoders. MP4 via WebCodecs + mp4-muxer
// (frame-accurate, deterministic), GIF via gifenc. Both consume already-rendered
// 2D canvases one frame at a time.

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { GIFEncoder, applyPalette, quantize } from "gifenc";

export interface FrameEncoder {
  addFrame: (canvas: HTMLCanvasElement) => void;
  finish: () => Promise<Blob> | Blob;
  /** release underlying resources (e.g. a live VideoEncoder) on error/abort */
  dispose: () => void;
  mime: string;
  ext: string;
}

export function supportsMp4(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

// H.264 levels we target, smallest-first: [level_idc (hex), MaxFS (macroblocks),
// MaxMBPS (macroblocks/sec)]. A frame is rejected by a level when it exceeds
// either the frame size (MaxFS) or the throughput (MaxMBPS) limit. Level 4.0
// (the old hardcoded value) tops out at 1920×1080; the lab allows up to 1920 on
// the long edge at any aspect — a 3:2 frame is 1920×1280, which needs ≥ 5.0.
const AVC_LEVELS: ReadonlyArray<readonly [hex: string, maxFs: number, maxMbps: number]> = [
  ["28", 8192, 245760], // 4.0
  ["29", 8192, 245760], // 4.1
  ["2a", 8704, 522240], // 4.2
  ["32", 22080, 589824], // 5.0
  ["33", 36864, 983040], // 5.1
  ["34", 36864, 2073600], // 5.2
];

/** Smallest Main-profile H.264 codec string that fits the frame size + rate. */
function avcCodec(w: number, h: number, fps: number): string {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const mbps = mbs * fps;
  const lvl = AVC_LEVELS.find(([, maxFs, maxMbps]) => mbs <= maxFs && mbps <= maxMbps);
  return `avc1.4d00${lvl ? lvl[0] : "34"}`; // fall back to 5.2 above the table
}

/** MP4 (H.264) encoder. Width/height must be even. */
export function createMp4Encoder(w: number, h: number, fps: number): FrameEncoder {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: w, height: h },
    fastStart: "in-memory",
  });
  // VideoEncoder reports config/encode failures asynchronously via this callback,
  // not by throwing. Capture the first error so addFrame can abort the frame loop
  // immediately and finish() can surface it instead of producing an empty file.
  let encodeError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError ??= e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure({
    codec: avcCodec(w, h, fps), // Main profile, level chosen to fit w×h@fps
    width: w,
    height: h,
    bitrate: 8_000_000,
    framerate: fps,
  });
  let n = 0;
  const frameDur = Math.round(1e6 / fps);
  return {
    mime: "video/mp4",
    ext: "mp4",
    addFrame(canvas) {
      if (encodeError) throw encodeError;
      const frame = new VideoFrame(canvas, { timestamp: n * frameDur, duration: frameDur });
      encoder.encode(frame, { keyFrame: n % (fps * 2) === 0 });
      frame.close();
      n++;
    },
    async finish() {
      await encoder.flush();
      if (encodeError) throw encodeError;
      muxer.finalize();
      return new Blob([target.buffer], { type: "video/mp4" });
    },
    dispose() {
      try {
        if (encoder.state !== "closed") encoder.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** Animated GIF encoder (256-colour palette per frame). */
export function createGifEncoder(w: number, h: number, fps: number): FrameEncoder {
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  return {
    mime: "image/gif",
    ext: "gif",
    addFrame(canvas) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
      const { data } = ctx.getImageData(0, 0, w, h);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      gif.writeFrame(index, w, h, { palette, delay });
    },
    finish() {
      gif.finish();
      return new Blob([gif.bytes() as BlobPart], { type: "image/gif" });
    },
    dispose() {
      /* gifenc holds no external resources */
    },
  };
}
