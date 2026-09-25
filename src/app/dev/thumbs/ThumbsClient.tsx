"use client";

import { useEffect, useRef, useState } from "react";
import { CpuEngine } from "@/lib/bg-lab/engine/cpu/cpuEngine";
import { PRESETS, EXAMPLES, presetBySlug } from "@/lib/bg-lab/presets";
import type { BgConfig } from "@/lib/bg-lab/types";

const W = 640;
const H = 427; // 3:2, matches the app's default aspect
const FALLBACK_REFERENCE = "/presets/_reference.png";

// One reference photo PER PRESET (Figma shader-panel style: every card gets
// its own subject, chosen to show the effect off — abstract/nature/landscape
// subjects, museum-poster register, no people). Values are Pexels photo ids;
// the CDN render URL is built below.
const PEXELS_REF: Record<string, string> = {
  // Paint
  "oil-paint": "37955191", // boats on a pebble beach
  "ink-sketch": "691043", // single fern frond on pale ground — reads as a botanical pen drawing
  brushwork: "31998295", // moody flower-vase still life
  // Print
  "floyd-dither": "9037438", // quartz crystal cluster macro
  "riso-halftone": "17867597", // monstera leaf on pale ground — prints like a riso poster
  "halftone-dots": "9406397", // long-exposure waterfall
  newsprint: "9313327", // snow-covered peaks through cloud
  "cmyk-print": "33492072", // red VW beetle on a sunny street
  risograph: "4611223", // red flowers, dark backdrop
  crosshatch: "7031226", // two deer close-up
  "gooey-halftone": "17598833", // colorful coral reef
  "blue-noise": "17366553", // foggy forest
  // Same clip as its example (Clouds), so the card previews what the example plays.
  "bayer-dither": EXAMPLES.find((e) => e.slug === "clouds-bayer")!.poster,
  "coarse-bayer": "34434151", // b&w architectural shadow play
  "floyd-colour": "27982385", // colorful flower arrangement
  "halftone-rings": "9579161", // giraffe face
  "threshold-ink": "20015727", // layered sandstone formations
  engraving: "17571139", // Venetian facade
  // Glitch
  "mosaic-tiles": "17594273", // geometric facade
  "vhs-glitch": "1366957", // skyline at night
  "crt-curve": "36504036", // night cityscape light trails
  chromatic: "28993172", // rain window bokeh
  dispersion: "3845161", // glass prism rainbow refraction
  vaporwave: "6562351", // illuminated arches at night
  "scanlines-rgb": "12060425", // blue/yellow curved light trails
  "sine-warp": "12039507", // aerial rocky coastline
  warp: "26547201", // abstract window grid
  "pixel-grain": "19315391", // orange Moskvitch
  "pixel-dots": "31793882", // meerkat on a rock
  "pixel-diamonds": "33729670.png", // grapes in a blue bowl
  lego: "10821202", // colorful fruit bowls
  crt: "17601245", // colorful abstract light streaks
  // Text
  "ascii-art": "10830765", // b&w birch forest, Helsinki
  "block-print": "12903905", // facade on blue sky
  "ascii-colour": "36341535", // colorful aerial tulip field
  "ascii-glow": "14677080", // neon tunnel
  diamonds: "12602053", // purple/blue crystal macro
  "rain-lines": "11605791", // cascading forest waterfall
  // Film
  "sepia-film": "6950602", // vintage cars
  "heavy-grain": "23247658", // dense birch forest, tall trunks
  "golden-hour": "12421067", // golden sunset field
  "god-rays": "34169562", // mist-covered trees
  "soft-focus": "37007878", // butterfly-bush vase
  bloom: "28735803", // sunrise over water
  // Grade
  duotone: "8935750", // dunes coastline
  "grade-bw": "18991882", // jagged blue glacier texture
  "grade-sepia": "11183944", // Antelope Canyon sandstone
  "grade-warm": "34730433", // sunset through a bare tree
  "grade-cool": "31213033", // winter mountains
  "grade-fade": "28610401", // layered pastel hills
  "grade-vintage": "18894303", // vintage car headlight + chrome, close-up
  "grade-cyber": "11518796", // long-exposure light trails
  "colour-wash": "8894570", // pink flowers in a teapot
  "vignette-fade": "5077838", // moody mist forest
  "poster-pop": "533355", // fruit in a striped bowl
};

// Ref values are "<id>" or "<id>.<ext>" — most photos are .jpeg on the CDN
// but not all (33729670 is .png), and a wrong extension 404s.
const pexelsUrl = (ref: string) => {
  // A full URL (e.g. an example's video poster) is used as-is.
  if (ref.startsWith("https://")) return ref;
  const [id, ext = "jpeg"] = ref.split(".");
  return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.${ext}?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940`;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // keep the canvas exportable (pexels CDN)
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

// Example (Looks rail) thumbnails: the example's own video poster frame through
// its preset, full frame at 16:9 — the card shows what clicking it plays.
const EXAMPLE_W = 480;
const EXAMPLE_H = 270;

type Job = {
  /** row key, e.g. "ink-sketch" or "example:koi-cmyk" */
  key: string;
  slug: string;
  kind: "presets" | "examples";
  render: (engine: CpuEngine, canvas: HTMLCanvasElement, fallback: HTMLImageElement) => Promise<void>;
};

const PRESET_JOBS: Job[] = PRESETS.map((preset) => ({
  key: preset.slug,
  slug: preset.slug,
  kind: "presets",
  render: async (engine, canvas, fallback) => {
    const config: BgConfig = {
      version: 1,
      output: { aspect: "3:2", longEdge: W },
      source: {
        mode: "image",
        imageId: "reference",
        solidColor: "#cdd9e0",
        // Center-crop zoom (~1.4×): at the 2-up gallery size a full-frame
        // scene reads as mush. Cropping to the middle 72% enlarges the
        // subject and the effect's own texture (dots, hatching, dither
        // cells) so each card actually shows what the effect does.
        transform: { crop: { x: 0.14, y: 0.14, w: 0.72, h: 0.72 } },
      },
      stack: preset.build(),
    };
    // No silent fallback for mapped refs — a CDN miss must surface as
    // an ✗ row, not quietly render the shared reference image.
    const refId = PEXELS_REF[preset.slug];
    const img = refId ? await loadImage(pexelsUrl(refId)) : fallback;
    engine.setSource({ kind: "image", image: img });
    engine.render(canvas, config, { W, H });
  },
}));

const EXAMPLE_JOBS: Job[] = EXAMPLES.map((example) => ({
  key: `example:${example.slug}`,
  slug: example.slug,
  kind: "examples",
  render: async (engine, canvas) => {
    const preset = presetBySlug(example.preset);
    if (!preset) throw new Error(`unknown preset ${example.preset}`);
    const config: BgConfig = {
      version: 1,
      output: { aspect: "16:9", longEdge: EXAMPLE_W },
      source: { mode: "image", imageId: "poster", solidColor: "#cdd9e0" },
      stack: preset.build(),
    };
    engine.setSource({ kind: "image", image: await loadImage(example.poster) });
    engine.render(canvas, config, { W: EXAMPLE_W, H: EXAMPLE_H });
  },
}));

// `?only=ink-sketch,examples` re-shoots a subset: preset slugs, `examples` (all
// example thumbs), or `example:<slug>`. No param = everything.
function selectJobs(only: string | null): Job[] {
  const all = [...PRESET_JOBS, ...EXAMPLE_JOBS];
  if (!only) return all;
  const keys = new Set(only.split(","));
  return all.filter((j) => keys.has(j.key) || (j.kind === "examples" && keys.has("examples")));
}

type Row = { key: string; status: "pending" | "ok" | "error"; note?: string };

export default function ThumbsClient({ only }: { only: string | null }) {
  const [jobs] = useState<Job[]>(() => selectJobs(only));
  const [rows, setRows] = useState<Row[]>(() => jobs.map((j) => ({ key: j.key, status: "pending" })));
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const fallback = await loadImage(FALLBACK_REFERENCE);
      const engine = new CpuEngine();
      const canvas = document.createElement("canvas");

      for (const job of jobs) {
        try {
          await job.render(engine, canvas, fallback);
          const dataUrl = canvas.toDataURL("image/webp", 0.9);
          const res = await fetch("/api/dev/thumbs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: job.slug, kind: job.kind, dataUrl }),
          });
          if (!res.ok) throw new Error(`write failed: ${res.status}`);
          setRows((r) => r.map((x) => (x.key === job.key ? { ...x, status: "ok" } : x)));
        } catch (e) {
          setRows((r) => r.map((x) => (x.key === job.key ? { ...x, status: "error", note: String(e) } : x)));
        }
      }
      engine.dispose();
      setDone(true);
    })();
  }, [jobs]);

  const ok = rows.filter((r) => r.status === "ok").length;
  const errs = rows.filter((r) => r.status === "error");

  return (
    <main className="mx-auto max-w-xl p-8 font-mono text-sm">
      <h1 className="mb-4 text-base font-semibold">Preset thumbnail generator</h1>
      <p data-thumbs-status={done ? "done" : "running"} className="mb-4">
        {done ? `done ${ok}/${rows.length}` : `rendering… ${ok}/${rows.length}`}
      </p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.key}>
            {r.status === "ok" ? "✓" : r.status === "error" ? "✗" : "·"} {r.key}
            {r.note ? ` — ${r.note}` : ""}
          </li>
        ))}
      </ul>
      {errs.length > 0 && <p className="mt-4 text-red-600">{errs.length} failed</p>}
    </main>
  );
}
