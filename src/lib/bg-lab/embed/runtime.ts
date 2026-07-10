// BG Lab — embed runtime. Zero React: mount a live shader background on any
// element from the SAME BgConfig the editor + LLM produce. Reuses the engine
// (CPU/GL behind one contract) and the schema validator, so an embedded config
// renders identically to the editor. Image sources load async; gradient /
// pattern / solid render synchronously.

import { createEngine, preferredEngineId, type EngineSource, type RenderEngine } from "../engine";
import { validateConfig } from "../schema";
import { DEFAULT_PATTERN } from "../patternCatalog";
import { DEFAULT_GRADIENT } from "../gradientCatalog";
import type { BgConfig } from "../types";

export interface ShaderBgHandle {
  /** swap the config (re-parses if a string) without re-mounting */
  setConfig(config: BgConfig | string): void;
  /** stop the loop + release the engine/canvas */
  destroy(): void;
  /** the canvas element (already appended to the target) */
  canvas: HTMLCanvasElement;
}

function parse(config: BgConfig | string): BgConfig {
  return typeof config === "string" ? validateConfig(config) : config;
}

function isAnimated(cfg: BgConfig): boolean {
  return cfg.source.mode === "video" || cfg.stack.some((e) => e.enabled && e.params?.animate === true);
}

// Build the (sync) engine source; image/video load async and call back.
function buildSource(cfg: BgConfig, onAsync: (s: EngineSource) => void): EngineSource {
  const s = cfg.source;
  if (s.mode === "gradient") return { kind: "gradient", gradient: s.gradient ?? DEFAULT_GRADIENT };
  if (s.mode === "pattern") return { kind: "pattern", pattern: s.pattern ?? DEFAULT_PATTERN };
  if (s.mode === "solid") return { kind: "solid", color: s.solidColor };
  const url = s.imageId;
  if ((s.mode === "image" || s.mode === "video") && url) {
    if (s.mode === "video") {
      const v = document.createElement("video");
      v.crossOrigin = "anonymous";
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      v.src = url.replace(/^pexels:(video:)?/, "");
      v.onloadeddata = () => {
        v.play().catch(() => {});
        onAsync({ kind: "video", video: v });
      };
    } else {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => onAsync({ kind: "image", image: im });
      im.src = url.replace(/^pexels:/, "");
    }
  }
  return null; // until the async source resolves
}

export function mountShaderBg(
  target: HTMLElement,
  config: BgConfig | string,
  opts: { dpr?: number } = {},
): ShaderBgHandle {
  let cfg = parse(config);
  const dprCap = opts.dpr ?? 2;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  if (getComputedStyle(target).position === "static") target.style.position = "relative";
  target.appendChild(canvas);

  let engine: RenderEngine = createEngine(preferredEngineId());
  let source: EngineSource = buildSource(cfg, (s) => {
    source = s;
    engine.setSource(source);
    draw();
  });
  engine.setSource(source);

  let raf = 0;
  let t0 = 0;
  let W = 1;
  let H = 1;

  function dims() {
    const dpr = Math.min(dprCap, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    W = Math.max(1, Math.round(target.clientWidth * dpr));
    H = Math.max(1, Math.round(target.clientHeight * dpr));
  }

  function draw(time?: number) {
    try {
      engine.render(canvas, cfg, { W, H }, time);
    } catch {
      // GL hiccup → drop to CPU once
      try {
        engine.dispose();
      } catch {
        /* ignore */
      }
      engine = createEngine("cpu");
      engine.setSource(source);
      engine.render(canvas, cfg, { W, H }, time);
    }
  }

  function loop() {
    if (!t0) t0 = performance.now();
    draw((performance.now() - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }

  function start() {
    cancelAnimationFrame(raf);
    dims();
    if (isAnimated(cfg)) loop();
    else draw();
  }

  const ro = new ResizeObserver(() => start());
  ro.observe(target);
  start();

  return {
    canvas,
    setConfig(next) {
      cfg = parse(next);
      source = buildSource(cfg, (s) => {
        source = s;
        engine.setSource(source);
        draw();
      });
      engine.setSource(source);
      start();
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      try {
        engine.dispose();
      } catch {
        /* ignore */
      }
      canvas.remove();
    },
  };
}
