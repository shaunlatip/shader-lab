import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageDown, Maximize, Minus, PanelBottomClose, PanelBottomOpen, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { createEngine, preferredEngineId, type RenderEngine } from "@/lib/bg-lab/engine";
import { aspectRatio, previewDims } from "@/lib/bg-lab/resolution";
import { IDENTITY, clampZoom, zoomToward, type View } from "@/lib/bg-lab/zoom";
import type { BgConfig, Dims } from "@/lib/bg-lab/types";
import { sourceKey } from "@/hooks/useImageSource";
import { useBgLab } from "./BgLabProvider";
import { useEngineSource } from "./SourceProvider";
import { IconTip, labButton } from "./panel";
import { VideoTransport } from "./VideoTransport";
import { ExamplesRail } from "./ExamplesRail";
import { useOnboarding } from "./OnboardingProvider";
import { useSourceDrop } from "./useSourceDrop";

const PAD = 56;

// Narrow stage (phone, or a tablet with a panel docked): tighter margins and
// a trimmed toolbar/transport.
const COMPACT_BELOW = 560;
const PAD_COMPACT = 24;
// Space held clear under the artwork so the floating toolbar (and the video
// transport above it) never sit on top of the canvas. Measured from the
// stage bottom to each overlay's top edge, minus the half-PAD the fit already
// leaves, plus a small gap.
const RESERVE = { still: 24, video: 72 };

function cssFit(boxW: number, boxH: number, ratio: number, pad = PAD) {
  let w = boxW - pad;
  let h = w / ratio;
  if (h > boxH - pad) {
    h = boxH - pad;
    w = h * ratio;
  }
  // Integer CSS size: fractional boxes antialias the bitmap edge and let the
  // element background peek through as a hairline fringe around the artwork.
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

export function Stage() {
  const { config } = useBgLab();
  const { engineSource, loading, error, key: resolvedKey } = useEngineSource();
  // Does the loaded engineSource belong to the source the config asks for?
  // False only while a new image/video loads (see the render loop).
  const sourceReady = resolvedKey === sourceKey(config.source);
  const heldConfigRef = useRef<BgConfig | null>(null);
  const { examplesOpen, setExamplesOpen } = useOnboarding();
  const { dragOver, dropHandlers } = useSourceDrop();
  // Nothing to render: no image/video picked, or it failed to load. Keyed off
  // the config (not a null engineSource), which is also null for the frame
  // before a load starts.
  const media = config.source.mode === "image" || config.source.mode === "video";
  const empty = !loading && (!!error || (media && !config.source.imageId));
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Lazily (re)create the engine. We must NOT eagerly build it in render
  // (`useRef(createEngine())` leaks a WebGL context per render), and we must be
  // able to rebuild it: React 18 StrictMode runs mount→cleanup→mount, and the
  // cleanup disposes the engine — without recreation the next frame would render
  // into a torn-down context (a transparent frame).
  const engineRef = useRef<RenderEngine | null>(null);
  const rafRef = useRef(0);
  const ensureEngine = (): RenderEngine => (engineRef.current ??= createEngine(preferredEngineId()));
  // Set when a render() throw demoted us to the CPU engine, so the next natural
  // retry point (a new engineSource) can rebuild the preferred engine instead of
  // being stuck on CPU for the rest of the session.
  const demotedRef = useRef(false);
  const lastSourceRef = useRef(engineSource);
  // Animated effects (grain/glitch `animate`) recreate this effect on every
  // config change; hoisting the clock to a ref keeps it running across those
  // re-runs instead of resetting to t=0 whenever a slider drags.
  const t0Ref = useRef<number | null>(null);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dims, setDims] = useState<Dims>({ W: 1, H: 1 });
  const [view, setView] = useState<View>(IDENTITY);
  // "Original" shows the untouched source (renders with an empty stack).
  const [showOriginal, setShowOriginal] = useState(false);

  const ratio = aspectRatio(config.output.aspect);
  const compact = box.w > 0 && box.w < COMPACT_BELOW;
  const pad = compact ? PAD_COMPACT : PAD;
  const isVideoSource = engineSource?.kind === "video";
  const reserve = isVideoSource ? RESERVE.video : RESERVE.still;
  const fit = cssFit(box.w, box.h, ratio, pad);
  // Checker only when the render can actually be transparent — as a resting
  // background it bleeds a light fringe around opaque artwork edges.
  const canBeTransparent = config.stack.some(
    (e) => e.enabled && e.params?.background === "transparent",
  );

  // A video source starts playing as soon as it's picked (muted + looped at
  // load), so an example reads as motion right away — except under reduced
  // motion, where the transport's Play stays the user's call. Switching away
  // pauses the old clip: loaded videos stay cached, and a cached clip left
  // playing keeps decoding in the background.
  useEffect(() => {
    if (engineSource?.kind !== "video") return;
    const video = engineSource.video;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) video.play().catch(() => {});
    return () => video.pause();
  }, [engineSource]);

  // release the GL context (and CPU resources) when the lab unmounts —
  // browsers cap live WebGL contexts, so leaking one per mount eventually kills
  // the oldest.
  useEffect(() => {
    const engine = engineRef;
    return () => {
      try {
        engine.current?.dispose();
      } catch {
        /* ignore */
      }
      engine.current = null; // force a fresh engine on the next (StrictMode) mount
    };
  }, []);

  // observe container size
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // recompute render dims when aspect/box change
  useEffect(() => {
    if (box.w < 2 || box.h < 2) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    setDims(previewDims(config.output.aspect, { w: box.w - pad, h: box.h - pad }, dpr));
  }, [box.w, box.h, config.output.aspect, pad]);

  // render loop. Static sources render once per change; video sources and
  // animated effects (glitch/film-dust/grain with `animate`) run a continuous
  // rAF driving a frame clock so the preview moves.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dims.W < 2) return;
    // Source and effects swap together: while a new image/video is still
    // loading, engineSource is the previous one, so keep drawing the config
    // that belongs to it. Otherwise an example switch (source + stack at once)
    // would flash the new effects over the old clip before the new clip lands.
    if (sourceReady) heldConfigRef.current = config;
    const base = sourceReady ? config : (heldConfigRef.current ?? config);
    const cfg = showOriginal ? { ...base, stack: [] } : base;
    const isVideo = engineSource?.kind === "video";
    // A video must keep looping even in "Original" view (it just runs with an
    // empty stack); animated effects only loop when we're showing the edit.
    const animated =
      isVideo || (!showOriginal && base.stack.some((e) => e.enabled && e.params?.animate === true));

    // engineSource changing is the natural retry point for a prior GL demotion:
    // a new source means a fresh render anyway, so rebuild the preferred engine
    // instead of staying stuck on CPU for the rest of the session. Config/dims/
    // showOriginal changes must NOT trigger this — only compare engineSource.
    if (demotedRef.current && lastSourceRef.current !== engineSource) {
      try {
        engineRef.current?.dispose();
      } catch {
        /* ignore */
      }
      engineRef.current = null;
      demotedRef.current = false;
    }
    lastSourceRef.current = engineSource;

    ensureEngine().setSource(engineSource);
    cancelAnimationFrame(rafRef.current);

    // A bad GL frame (context loss, driver quirk) shouldn't freeze the preview —
    // drop to the CPU engine once and re-render. Observable so a broken shader
    // doesn't go unnoticed (see selfCheck in GLEngine for the dev-time check).
    const renderFrame = (time?: number) => {
      try {
        ensureEngine().render(canvas, cfg, dims, time);
      } catch (err) {
        console.warn("[bg-lab] GL render failed — falling back to CPU engine:", err);
        try {
          engineRef.current?.dispose();
        } catch {
          /* ignore */
        }
        const cpuEngine = createEngine("cpu");
        engineRef.current = cpuEngine;
        // Only mark for retry if we actually demoted away from a GL preference —
        // if "cpu" was already preferred, there's nothing to recover to.
        if (preferredEngineId() !== "cpu") demotedRef.current = true;
        cpuEngine.setSource(engineSource);
        cpuEngine.render(canvas, cfg, dims, time);
      }
    };

    if (!animated) {
      rafRef.current = requestAnimationFrame(() => renderFrame());
      return () => cancelAnimationFrame(rafRef.current);
    }

    let stopped = false;
    t0Ref.current ??= performance.now();
    const t0 = t0Ref.current;
    const loop = () => {
      if (stopped) return;
      renderFrame((performance.now() - t0) / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [config, engineSource, dims, showOriginal, sourceReady]);

  // wheel zoom toward cursor
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Zoom about the artwork's resting center, which sits above the
      // reserved bottom strip (not at the element's geometric center).
      const cx = e.clientX - (r.left + r.width / 2);
      const cy = e.clientY - (r.top + (r.height - reserve) / 2);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setView((v) => zoomToward(v, factor, cx, cy));
    },
    [reserve],
  );

  // drag to pan
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    // Snapshot the ref before the state updater runs — pointerup/leave can null
    // drag.current between this guard and React invoking the updater, which used
    // to throw "Cannot read properties of null (reading 'panX')".
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    setView((v) => ({ ...v, panX: d.panX + dx, panY: d.panY + dy }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const zoomPct = Math.round(view.zoom * 100);
  const oneToOne = () => setView({ zoom: clampZoom(dims.W / fit.w), panX: 0, panY: 0 });

  return (
    <div className="flex h-full w-full flex-col">
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <div
        ref={boxRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        {...dropHandlers}
        // Quiet solid studio surface, one step below the panel canvas so the
        // artwork reads as a print on a table. Theme-aware; transparency is
        // signaled by the canvas element's own checker, not the stage.
        className="relative flex flex-1 cursor-grab touch-none items-center justify-center overflow-hidden bg-shade-10 active:cursor-grabbing dark:bg-shade-1"
        // Bottom padding holds the toolbar/transport strip clear; the
        // ResizeObserver reads the content box, so the fit shrinks and the
        // artwork centers in the space above it.
        style={{ paddingBottom: reserve }}
      >
        <div
          style={{
            width: fit.w,
            height: fit.h,
            transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
          }}
          className="relative will-change-transform"
        >
          <canvas
            ref={canvasRef}
            style={{ width: "100%", height: "100%", display: "block" }}
            className={cn(
              "rounded-[2px] shadow-5 ring-1 ring-black/[0.06]",
              canBeTransparent && "checker-transparency",
              empty && "invisible",
            )}
          />
          {empty && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-frame border border-dashed border-border-strong px-6 text-center">
              <ImageDown className="h-5 w-5 text-text-secondary" />
              <p className="text-[13px] font-medium text-text-primary">
                {error ?? "No source yet"}
              </p>
              <p className="max-w-[320px] text-[12px] leading-snug text-text-secondary">
                Drop an image or video here, upload one on the left
                {examplesOpen ? ", or pick an example below." : "."}
              </p>
              {!examplesOpen && (
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setExamplesOpen(true)}
                  className={cn(labButton, "mt-1 h-8 rounded-control px-3 text-[12px]")}
                >
                  Show examples
                </button>
              )}
            </div>
          )}
        </div>
        {loading && (
          <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-border-default bg-canvas/90 px-2 py-0.5 text-[11px] text-text-secondary shadow-2 backdrop-blur">
            loading…
          </span>
        )}
        {engineSource?.kind === "video" && <VideoTransport video={engineSource.video} compact={compact} />}
        {dragOver && (
          <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-text-primary bg-canvas/80 backdrop-blur-sm">
            <ImageDown className="h-6 w-6 text-text-primary" />
            <span className="text-[13px] font-medium text-text-primary">Drop to set as source</span>
          </div>
        )}
      </div>

      {/* zoom HUD — light pill floating over the editorial stage */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border-default bg-canvas/90 px-1 py-1 text-text-primary shadow-3 backdrop-blur">
        <IconTip label={examplesOpen ? "Hide examples" : "Show examples"}>
          <Button
            variant="ghost"
            size="icon-xs"
            className={cn(
              "pointer-events-auto transition-[transform,background-color,color] duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-90",
              examplesOpen ? "text-text-primary" : "text-text-secondary",
            )}
            onClick={() => setExamplesOpen(!examplesOpen)}
            aria-label="Toggle examples"
            aria-pressed={examplesOpen}
          >
            {/* The examples strip is a bottom panel: the icon says which way
                the click goes (open vs close). */}
            {examplesOpen ? <PanelBottomClose className="h-3.5 w-3.5" /> : <PanelBottomOpen className="h-3.5 w-3.5" />}
          </Button>
        </IconTip>
        <div className="mx-0.5 h-4 w-px bg-border-default" />
        {/* Original ↔ Edited preview toggle */}
        <div className="pointer-events-auto flex items-center rounded-full bg-surface-active p-0.5 text-[10px] font-medium">
          {([["Original", true], ["Edited", false]] as const).map(([label, orig]) => (
            <button
              key={label}
              type="button"
              onClick={() => setShowOriginal(orig)}
              className={cn(
                "rounded-full px-2 py-0.5 transition-colors",
                showOriginal === orig ? "bg-canvas text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mx-0.5 h-4 w-px bg-border-default" />
        <IconTip label="Zoom out">
          <Button variant="ghost" size="icon-xs" className="pointer-events-auto text-text-secondary transition-[transform,background-color,color] duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-90" onClick={() => setView((v) => zoomToward(v, 1 / 1.2, 0, 0))} aria-label="Zoom out">
            <Minus className="h-3.5 w-3.5" />
          </Button>
        </IconTip>
        <button
          className="pointer-events-auto min-w-[44px] rounded text-center font-mono text-[11px] tabular-nums text-text-primary transition-[transform,color] duration-150 hover:text-text-secondary active:scale-95"
          onClick={() => setView(IDENTITY)}
        >
          {zoomPct}%
        </button>
        <IconTip label="Zoom in">
          <Button variant="ghost" size="icon-xs" className="pointer-events-auto text-text-secondary transition-[transform,background-color,color] duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-90" onClick={() => setView((v) => zoomToward(v, 1.2, 0, 0))} aria-label="Zoom in">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </IconTip>
        <div className="mx-0.5 h-4 w-px bg-border-default" />
        <IconTip label="Fit to view">
          <Button variant="ghost" size="icon-xs" className="pointer-events-auto text-text-secondary transition-[transform,background-color,color] duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-90" onClick={() => setView(IDENTITY)} aria-label="Fit">
            <Maximize className="h-3.5 w-3.5" />
          </Button>
        </IconTip>
        {/* Compact stages drop the 1:1 / reset-view extras; zoom + fit remain. */}
        {!compact && (
          <>
            <IconTip label="Zoom to 100%">
              <Button variant="ghost" size="icon-xs" className="pointer-events-auto text-text-secondary transition-[transform,background-color,color] duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-90" onClick={oneToOne} aria-label="100%">
                <span className="font-mono text-[10px]">1:1</span>
              </Button>
            </IconTip>
            <IconTip label="Reset view">
              <Button variant="ghost" size="icon-xs" className="pointer-events-auto text-text-secondary transition-[transform,background-color,color] duration-150 hover:bg-surface-hover hover:text-text-primary active:scale-90" onClick={() => setView(IDENTITY)} aria-label="Reset">
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </IconTip>
          </>
        )}
      </div>
    </div>
    {examplesOpen && <ExamplesRail />}
    </div>
  );
}
