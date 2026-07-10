#!/usr/bin/env bun
// BG Lab — headless CLI batch renderer. The agent-native payoff of config-as-JSON:
// an agent generates N config variants overnight → one contact sheet in the morning.
//
//   bun scripts/render.ts config.json --out tex.png [--size 8000x4500]
//   bun scripts/render.ts ./configs --out ./out          # batch a dir + contact sheet
//
// Drives the SAME CPU engine the editor uses for export (the source of truth),
// under Node via @napi-rs/canvas (skia: conic gradients, Path2D, filters). We
// shim the browser canvas globals the engine expects, then render.

import { createCanvas as createCanvasRaw, Image, Path2D as NPath2D, ImageData as NImageData, loadImage, type Canvas } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, basename, extname } from "node:path";

// createCanvas is overloaded (Canvas | SvgCanvas); the 2-arg form is always a
// raster Canvas — narrow it once here.
const createCanvas = (w: number, h: number): Canvas => createCanvasRaw(w, h) as Canvas;

// --- shim the browser canvas globals BEFORE the engine calls them (call-time,
// so static imports below are fine). tmpCanvas() falls to `new OffscreenCanvas`
// when there's no document; gradient/warp/mesh use it too.
const g = globalThis as unknown as Record<string, unknown>;
class OffscreenCanvasShim {
  constructor(w: number, h: number) {
    return createCanvas(Math.max(1, w | 0), Math.max(1, h | 0)) as unknown as OffscreenCanvasShim;
  }
}
g.OffscreenCanvas ??= OffscreenCanvasShim;
g.Path2D ??= NPath2D;
g.ImageData ??= NImageData;
g.Image ??= Image;

import { CpuEngine } from "../src/lib/bg-lab/engine/cpu/cpuEngine";
import { validateConfig } from "../src/lib/bg-lab/schema";
import { outputDims, MAX_EXPORT_PIXELS } from "../src/lib/bg-lab/resolution";
import { DEFAULT_GRADIENT } from "../src/lib/bg-lab/gradientCatalog";
import { DEFAULT_PATTERN } from "../src/lib/bg-lab/patternCatalog";
import type { BgConfig, Dims } from "../src/lib/bg-lab/types";
import type { EngineSource } from "../src/lib/bg-lab/engine/types";

async function sourceFor(cfg: BgConfig): Promise<EngineSource> {
  const s = cfg.source;
  if (s.mode === "gradient") return { kind: "gradient", gradient: s.gradient ?? DEFAULT_GRADIENT };
  if (s.mode === "pattern") return { kind: "pattern", pattern: s.pattern ?? DEFAULT_PATTERN };
  if (s.mode === "solid") return { kind: "solid", color: s.solidColor };
  if (s.mode === "image" && s.imageId) {
    // local path or data/URL
    const img = await loadImage(s.imageId.replace(/^pexels:/, ""));
    return { kind: "image", image: img as unknown as CanvasImageSource & { width: number; height: number } };
  }
  return null;
}

async function renderConfig(cfg: BgConfig, dims: Dims): Promise<Buffer> {
  const canvas = createCanvas(dims.W, dims.H);
  const engine = new CpuEngine();
  engine.setSource(await sourceFor(cfg));
  engine.render(canvas as unknown as HTMLCanvasElement, cfg, dims);
  engine.dispose();
  return canvas.toBuffer("image/png");
}

function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) opt[a.slice(2)] = argv[++i] ?? "true";
    else pos.push(a);
  }
  return { input: pos[0], opt };
}

function dimsFor(cfg: BgConfig, sizeOpt?: string): Dims {
  if (sizeOpt && /^\d+x\d+$/.test(sizeOpt)) {
    const [w, h] = sizeOpt.split("x").map(Number);
    return { W: w, H: h };
  }
  return outputDims(cfg.output.aspect, cfg.output.longEdge);
}

async function main() {
  const { input, opt } = parseArgs(process.argv.slice(2));
  if (!input) {
    console.error("usage: bun scripts/render.ts <config.json|dir> --out <path> [--size WxH]");
    process.exit(1);
  }
  const st = statSync(input);

  if (st.isFile()) {
    const cfg = validateConfig(readFileSync(input, "utf8"));
    const dims = dimsFor(cfg, opt.size);
    if (dims.W * dims.H > MAX_EXPORT_PIXELS) {
      console.error(`${((dims.W * dims.H) / 1e6) | 0} MP exceeds the ${MAX_EXPORT_PIXELS / 1e6} MP cap`);
      process.exit(1);
    }
    const out = opt.out ?? input.replace(/\.json$/, ".png");
    writeFileSync(out, await renderConfig(cfg, dims));
    console.log(`✓ ${out}  (${dims.W}×${dims.H})`);
    return;
  }

  // directory → batch + contact sheet
  const outDir = opt.out ?? join(input, "out");
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(input).filter((f) => extname(f) === ".json");
  const thumbs: { name: string; canvas: Canvas }[] = [];
  for (const f of files) {
    try {
      const cfg = validateConfig(readFileSync(join(input, f), "utf8"));
      const dims = dimsFor(cfg, opt.size);
      const buf = await renderConfig(cfg, dims);
      const outName = basename(f, ".json") + ".png";
      writeFileSync(join(outDir, outName), buf);
      const tc = createCanvas(dims.W, dims.H);
      const timg = await loadImage(buf);
      tc.getContext("2d").drawImage(timg, 0, 0);
      thumbs.push({ name: outName, canvas: tc });
      console.log(`✓ ${outName}  (${dims.W}×${dims.H})`);
    } catch (e) {
      console.error(`✗ ${f}: ${(e as Error).message}`);
    }
  }

  if (thumbs.length) {
    const cols = Math.ceil(Math.sqrt(thumbs.length));
    const rows = Math.ceil(thumbs.length / cols);
    const cell = 360;
    const pad = 12;
    const sheet = createCanvas(cols * (cell + pad) + pad, rows * (cell + pad) + pad);
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#0e0e10";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    thumbs.forEach((t, i) => {
      const cx = pad + (i % cols) * (cell + pad);
      const cy = pad + Math.floor(i / cols) * (cell + pad);
      const r = Math.min(cell / t.canvas.width, cell / t.canvas.height);
      const w = t.canvas.width * r;
      const h = t.canvas.height * r;
      ctx.drawImage(t.canvas, cx + (cell - w) / 2, cy + (cell - h) / 2, w, h);
    });
    const sheetPath = join(outDir, "contact.png");
    writeFileSync(sheetPath, sheet.toBuffer("image/png"));
    console.log(`\n✓ contact sheet → ${sheetPath}  (${thumbs.length} configs)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
