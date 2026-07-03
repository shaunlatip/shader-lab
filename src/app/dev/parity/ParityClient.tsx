"use client";

// Dev-only GL/CPU parity + benchmark harness UI. Not linked from the app nav —
// reached directly at /dev/parity, and gated out of production by the parent
// server component. Deliberately bare-bones: this is a diagnostic tool, not a
// product surface.

import { useCallback, useMemo, useRef, useState } from "react";
import { createEngine, type EngineId, type RenderEngine } from "@/lib/bg-lab/engine";
import { makeDefaultConfig, makeEffect } from "@/lib/bg-lab/presets";
import type { BgConfig, Dims, Effect, EffectType, ParamValue } from "@/lib/bg-lab/types";

const TEST_IMAGE_URL = "/explorations/asset-bg/img/mon-haystack.png";
const DIMS: Dims = { W: 800, H: 533 };
const BENCH_FRAMES = 60;

interface TestConfig {
  label: string;
  stack: { type: EffectType; params?: Record<string, ParamValue> }[];
}

const TEST_CONFIGS: TestConfig[] = [
  {
    label: "Pixelate + grain",
    stack: [{ type: "pixelate" }, { type: "grain" }],
  },
  {
    label: "Halftone",
    stack: [{ type: "halftone", params: {} }],
  },
  {
    label: "Halftone · CMYK",
    stack: [{ type: "halftone", params: { mode: "cmyk" } }],
  },
  {
    label: "Halftone · square+stagger",
    stack: [{ type: "halftone", params: { dotShape: "square", stagger: true, angle: 22, contrast: 1.3 } }],
  },
  {
    label: "Dither · Bayer 4x4",
    stack: [{ type: "dither", params: { type: "bayer4" } }],
  },
  {
    label: "Dither · Floyd-Steinberg",
    stack: [{ type: "dither", params: { type: "floydSteinberg" } }],
  },
  {
    label: "Kuwahara · fast",
    stack: [{ type: "kuwahara", params: {} }],
  },
  {
    label: "Kuwahara · smooth",
    stack: [{ type: "kuwahara", params: { quality: "smooth" } }],
  },
  {
    label: "Gradient map",
    stack: [{ type: "gradientMap", params: {} }],
  },
  {
    label: "Gradient map · 4 stops",
    stack: [
      {
        type: "gradientMap",
        params: {
          stops: [
            { t: 0, color: "#0a0a14" },
            { t: 0.35, color: "#7a2848" },
            { t: 0.7, color: "#e8845a" },
            { t: 1, color: "#f7ecd9" },
          ],
        },
      },
    ],
  },
  {
    label: "CRT curvature",
    stack: [{ type: "crtCurvature", params: {} }],
  },
  {
    label: "Grain (stochastic — stats only)",
    stack: [{ type: "grain", params: {} }],
  },
  {
    label: "Line art · outline",
    stack: [{ type: "lineArt", params: {} }],
  },
  {
    label: "Line art · ink+hatch",
    stack: [{ type: "lineArt", params: { mode: "ink", hatchSpacing: 6 } }],
  },
];

function buildConfig(test: TestConfig): BgConfig {
  const cfg = makeDefaultConfig();
  cfg.source = { mode: "image", imageId: "mon-haystack", solidColor: "#cdd9e0" };
  cfg.stack = test.stack.map((s): Effect => {
    const eff = makeEffect(s.type);
    if (s.params) eff.params = { ...eff.params, ...s.params };
    return eff;
  });
  return cfg;
}

function loadTestImage(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load test image"));
    img.src = TEST_IMAGE_URL;
  });
}

function hasRealWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

interface ParityResult {
  maxDelta: number;
  meanDelta: number;
  pctDiffPixels: number;
}

function diffImageData(a: ImageData, b: ImageData): ParityResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const pa = a.data;
  const pb = b.data;
  let maxDelta = 0;
  let sumDelta = 0;
  let sumCount = 0;
  let diffPixels = 0;
  const pixelCount = a.width * a.height;
  for (let p = 0; p < pixelCount; p++) {
    const base = p * 4;
    let pixelDiffers = false;
    for (let c = 0; c < 4; c++) {
      const d = Math.abs(pa[base + c] - pb[base + c]);
      if (d > maxDelta) maxDelta = d;
      sumDelta += d;
      sumCount++;
      if (d > 1) pixelDiffers = true;
    }
    if (pixelDiffers) diffPixels++;
  }
  return {
    maxDelta,
    meanDelta: sumDelta / sumCount,
    pctDiffPixels: (diffPixels / pixelCount) * 100,
  };
}

function renderOnce(engineId: EngineId, canvas: HTMLCanvasElement, config: BgConfig, dims: Dims, image: HTMLImageElement, time?: number): void {
  let engine: RenderEngine | null = null;
  try {
    engine = createEngine(engineId);
    engine.setSource({ kind: "image", image });
    engine.render(canvas, config, dims, time);
  } finally {
    engine?.dispose();
  }
}

interface BenchResult {
  msPerFrame: number;
  totalMs: number;
}

function benchEngine(engineId: EngineId, config: BgConfig, dims: Dims, image: HTMLImageElement): BenchResult {
  const canvas = document.createElement("canvas");
  const engine = createEngine(engineId);
  try {
    engine.setSource({ kind: "image", image });
    const t0 = performance.now();
    for (let i = 0; i < BENCH_FRAMES; i++) {
      engine.render(canvas, config, dims, i / 30);
    }
    const totalMs = performance.now() - t0;
    return { totalMs, msPerFrame: totalMs / BENCH_FRAMES };
  } finally {
    engine.dispose();
  }
}

export default function ParityClient() {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);

  const [parityResult, setParityResult] = useState<ParityResult | null>(null);
  const [parityError, setParityError] = useState<string | null>(null);
  const [parityRunning, setParityRunning] = useState(false);

  const [benchResults, setBenchResults] = useState<{ gl: BenchResult | null; cpu: BenchResult | null }>({ gl: null, cpu: null });
  const [benchError, setBenchError] = useState<string | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);

  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cpuCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const realWebGL2 = useMemo(() => hasRealWebGL2(), []);
  const selected = TEST_CONFIGS[selectedIdx];
  const config = useMemo(() => buildConfig(selected), [selected]);

  const ensureImage = useCallback(async (): Promise<HTMLImageElement> => {
    if (image) return image;
    setLoadingImage(true);
    setImageError(null);
    try {
      const img = await loadTestImage();
      setImage(img);
      return img;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setImageError(msg);
      throw err;
    } finally {
      setLoadingImage(false);
    }
  }, [image]);

  const runParity = useCallback(async () => {
    setParityRunning(true);
    setParityError(null);
    setParityResult(null);
    try {
      const img = await ensureImage();
      const glCanvas = glCanvasRef.current;
      const cpuCanvas = cpuCanvasRef.current;
      if (!glCanvas || !cpuCanvas) throw new Error("canvas refs not mounted");

      renderOnce("gl", glCanvas, config, DIMS, img);
      renderOnce("cpu", cpuCanvas, config, DIMS, img);

      // Both engines draw into `target` via an internal drawImage/2D composite
      // (the GL engine keeps its own offscreen WebGL canvas and blits from it),
      // so the target canvases here are always plain 2D-context canvases.
      const glImageData = glCanvas.getContext("2d")?.getImageData(0, 0, DIMS.W, DIMS.H);
      const cpuImageData = cpuCanvas.getContext("2d")?.getImageData(0, 0, DIMS.W, DIMS.H);
      if (!glImageData || !cpuImageData) {
        throw new Error("could not read back pixel data from target canvases (2d context unavailable)");
      }
      setParityResult(diffImageData(glImageData, cpuImageData));
    } catch (err) {
      setParityError(err instanceof Error ? err.message : String(err));
    } finally {
      setParityRunning(false);
    }
  }, [config, ensureImage]);

  const runBench = useCallback(async () => {
    setBenchRunning(true);
    setBenchError(null);
    setBenchResults({ gl: null, cpu: null });
    try {
      const img = await ensureImage();
      const gl = benchEngine("gl", config, DIMS, img);
      const cpu = benchEngine("cpu", config, DIMS, img);
      setBenchResults({ gl, cpu });
    } catch (err) {
      setBenchError(err instanceof Error ? err.message : String(err));
    } finally {
      setBenchRunning(false);
    }
  }, [config, ensureImage]);

  return (
    <div className="min-h-screen bg-neutral-950 p-6 font-mono text-sm text-neutral-200">
      <h1 className="mb-1 text-lg font-bold text-white">GL / CPU parity + bench harness</h1>
      <p className="mb-4 text-neutral-400">Dev-only. Not linked from the app. {loadingImage ? "Loading test image…" : null}</p>

      {!realWebGL2 && (
        <div className="mb-4 border border-yellow-700 bg-yellow-950 p-3 text-yellow-300">
          Warning: this browser has no real WebGL2 context. createEngine(&quot;gl&quot;) will silently fall back to the CPU
          engine, so GL parity/bench numbers below are not meaningful — both columns will effectively be CPU vs CPU.
        </div>
      )}

      {imageError && <div className="mb-4 border border-red-700 bg-red-950 p-3 text-red-300">Image load error: {imageError}</div>}

      <div className="mb-6">
        <div className="mb-2 text-neutral-400">Config:</div>
        <div className="flex flex-wrap gap-2">
          {TEST_CONFIGS.map((t, i) => (
            <button
              key={t.label}
              onClick={() => {
                setSelectedIdx(i);
                setParityResult(null);
                setParityError(null);
                setBenchResults({ gl: null, cpu: null });
                setBenchError(null);
              }}
              className={`border px-3 py-1 ${
                i === selectedIdx ? "border-white bg-neutral-800 text-white" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 flex gap-3">
        <button
          onClick={() => void runParity()}
          disabled={parityRunning}
          className="border border-neutral-600 px-4 py-2 hover:bg-neutral-800 disabled:opacity-50"
        >
          {parityRunning ? "Running parity…" : "Run Parity"}
        </button>
        <button
          onClick={() => void runBench()}
          disabled={benchRunning}
          className="border border-neutral-600 px-4 py-2 hover:bg-neutral-800 disabled:opacity-50"
        >
          {benchRunning ? `Running bench (${BENCH_FRAMES} frames x2)…` : "Run Bench"}
        </button>
      </div>

      {parityError && <div className="mb-4 border border-red-700 bg-red-950 p-3 text-red-300">Parity error: {parityError}</div>}
      {benchError && <div className="mb-4 border border-red-700 bg-red-950 p-3 text-red-300">Bench error: {benchError}</div>}

      <div className="mb-6 flex gap-4">
        <div>
          <div className="mb-1 text-neutral-400">GL ({DIMS.W}x{DIMS.H})</div>
          <canvas ref={glCanvasRef} width={DIMS.W} height={DIMS.H} className="border border-neutral-700" style={{ width: 320, height: 320 * (DIMS.H / DIMS.W) }} />
        </div>
        <div>
          <div className="mb-1 text-neutral-400">CPU ({DIMS.W}x{DIMS.H})</div>
          <canvas ref={cpuCanvasRef} width={DIMS.W} height={DIMS.H} className="border border-neutral-700" style={{ width: 320, height: 320 * (DIMS.H / DIMS.W) }} />
        </div>
      </div>

      {parityResult && (
        <div className="mb-6 border border-neutral-700 p-3">
          <div className="mb-1 text-white">Parity result</div>
          <div>max channel delta: {parityResult.maxDelta.toFixed(2)} / 255</div>
          <div>mean channel delta: {parityResult.meanDelta.toFixed(4)} / 255</div>
          <div>% pixels with any channel delta &gt; 1: {parityResult.pctDiffPixels.toFixed(3)}%</div>
        </div>
      )}

      {(benchResults.gl || benchResults.cpu) && (
        <div className="border border-neutral-700 p-3">
          <div className="mb-1 text-white">
            Bench result ({BENCH_FRAMES} frames, {DIMS.W}x{DIMS.H})
          </div>
          <div>GL: {benchResults.gl ? `${benchResults.gl.msPerFrame.toFixed(3)} ms/frame (${benchResults.gl.totalMs.toFixed(1)} ms total)` : "—"}</div>
          <div>CPU: {benchResults.cpu ? `${benchResults.cpu.msPerFrame.toFixed(3)} ms/frame (${benchResults.cpu.totalMs.toFixed(1)} ms total)` : "—"}</div>
        </div>
      )}
    </div>
  );
}
