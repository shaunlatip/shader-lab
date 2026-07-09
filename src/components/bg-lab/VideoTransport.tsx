import { useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconTip } from "./panel";

const fmt = (s: number) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

type VideoWithRVFC = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

/** Playback transport for a video source: play/pause, stop, scrub, speed, loop,
 * and a live FPS readout. The Stage render loop draws whatever frame the video is
 * on, so this just drives the underlying <video>. */
export function VideoTransport({ video }: { video: HTMLVideoElement }) {
  const [playing, setPlaying] = useState(!video.paused);
  const [t, setT] = useState(video.currentTime);
  const [dur, setDur] = useState(video.duration || 0);
  const [loop, setLoop] = useState(video.loop);
  const [speed, setSpeed] = useState(video.playbackRate || 1);
  const [fps, setFps] = useState(0);
  const rafRef = useRef(0);

  useEffect(() => {
    // Resync from the (possibly new/cached) element — useState only initialised
    // once, so without this the icon/scrubber reflect the previous clip.
    setPlaying(!video.paused);
    setLoop(video.loop);
    setT(video.currentTime);
    setDur(video.duration || 0);
    setSpeed(video.playbackRate || 1);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onMeta = () => setDur(video.duration || 0);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("loadedmetadata", onMeta);
    const tick = () => {
      setT(video.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("loadedmetadata", onMeta);
      cancelAnimationFrame(rafRef.current);
    };
  }, [video]);

  // live FPS via per-presented-frame callback (real playback fps), windowed
  useEffect(() => {
    const v = video as VideoWithRVFC;
    let frames = 0;
    let last = performance.now();
    let cancelled = false;
    if (v.requestVideoFrameCallback) {
      const loop2 = () => {
        if (cancelled) return;
        frames++;
        v.requestVideoFrameCallback!(loop2);
      };
      v.requestVideoFrameCallback!(loop2);
    }
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      if (dt > 0) setFps(Math.round(frames / dt));
      frames = 0;
      last = now;
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [video]);

  const toggle = () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  };
  const stop = () => {
    video.pause();
    video.currentTime = 0;
  };
  const toggleLoop = () => {
    video.loop = !video.loop;
    setLoop(video.loop);
  };
  const setRate = (r: number) => {
    video.playbackRate = r;
    setSpeed(r);
  };

  const iconBtn =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-150 active:scale-90";

  return (
    <div className="pointer-events-auto absolute bottom-14 left-1/2 flex w-[min(520px,86%)] -translate-x-1/2 flex-col gap-1.5 rounded-2xl border border-border-default bg-canvas/90 px-3 py-2 text-text-primary shadow-3 backdrop-blur">
      <div className="flex items-center gap-2">
        <IconTip label={playing ? "Pause" : "Play"}>
          <button type="button" onClick={toggle} className={cn(iconBtn, "bg-surface-hover hover:bg-surface-active")} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
        </IconTip>
        <IconTip label="Stop">
          <button type="button" onClick={stop} className={cn(iconBtn, "text-text-secondary hover:bg-surface-hover hover:text-text-primary")} aria-label="Stop">
            <Square className="h-3 w-3" />
          </button>
        </IconTip>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-secondary">{fmt(t)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, dur)}
          step={0.01}
          value={Math.min(t, dur)}
          onChange={(e) => {
            video.currentTime = Number(e.target.value);
            setT(video.currentTime);
          }}
          className="h-1 flex-1 cursor-pointer accent-accent"
        />
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-text-secondary">{fmt(dur)}</span>
        <IconTip label={loop ? "Loop on" : "Loop off"}>
          <button type="button" onClick={toggleLoop} className={cn(iconBtn, loop ? "bg-surface-active text-text-primary" : "text-text-secondary hover:bg-surface-hover")} aria-label="Toggle loop">
            <Repeat className="h-3.5 w-3.5" />
          </button>
        </IconTip>
      </div>
      <div className="flex items-center justify-between gap-2 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-text-secondary">Speed</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRate(s)}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] tabular-nums transition-colors",
                speed === s ? "bg-surface-active text-text-primary" : "text-text-secondary hover:text-text-primary",
              )}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="font-mono text-[10px] tabular-nums text-text-secondary">{fps} fps</span>
      </div>
    </div>
  );
}
