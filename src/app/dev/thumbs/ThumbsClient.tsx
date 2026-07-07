"use client";

import { useEffect, useRef, useState } from "react";
import { CpuEngine } from "@/lib/bg-lab/engine/cpu/cpuEngine";
import { DEFAULT_PATTERN } from "@/lib/bg-lab/patternCatalog";
import { PRESETS } from "@/lib/bg-lab/presets";
import type { BgConfig } from "@/lib/bg-lab/types";

const W = 640;
const H = 427; // 3:2, matches the app's default aspect
const FALLBACK_REFERENCE = "/presets/_reference.png";

// One reference photo PER PRESET (Figma shader-panel style: every card gets
// its own subject, chosen to show the effect off — b&w street for newsprint,
// a giraffe's spots for halftone rings, neon for the glitch family). Values
// are Pexels photo ids; the CDN render URL is built below. Scene presets are
// absent on purpose — they render their own generative pattern source.
const PEXELS_REF: Record<string, string> = {
  // Print
  newsprint: "22243358", // b&w market crowd
  "cmyk-print": "33492072", // red VW beetle on a sunny street
  risograph: "4611223", // red flowers, dark backdrop
  "floyd-dither": "20354087", // half-face b&w portrait
  crosshatch: "7031226", // two deer close-up
  "halftone-dots": "35659475", // child in fur hood, b&w
  "gooey-halftone": "7853661", // colorful eye-makeup close-up
  "blue-noise": "17366553", // foggy forest
  "bayer-dither": "9612453", // geometric building facade
  "coarse-bayer": "32933048", // silhouettes crossing, b&w
  "floyd-colour": "27982385", // colorful flower arrangement
  "halftone-rings": "9579161", // giraffe face
  "threshold-ink": "26545590", // woman at zebra crossing, b&w
  engraving: "17571139", // Venetian facade
  // Text
  "ascii-art": "11830378", // grayscale portrait
  "block-print": "12903905", // facade on blue sky
  "ascii-colour": "10175091", // Hong Kong neon street
  "ascii-glow": "14677080", // neon tunnel
  diamonds: "30403762", // b&w curly-hair portrait
  "rain-lines": "10493305", // rain-soaked night street
  // Paint
  "oil-paint": "37955191", // boats on a pebble beach
  "ink-sketch": "34661813", // young man portrait outdoors
  brushwork: "31998295", // moody flower-vase still life
  // Film
  "sepia-film": "6950602", // vintage cars
  "heavy-grain": "20719100", // monochrome winter street
  "golden-hour": "12421067", // golden sunset field
  "god-rays": "34169562", // mist-covered trees
  "soft-focus": "37007878", // butterfly-bush vase
  bloom: "28735803", // sunrise over water
  // Grade
  duotone: "8935750", // dunes coastline
  "grade-bw": "22867971", // b&w emotional portrait
  "grade-sepia": "19333154", // elderly street seller
  "grade-warm": "34730433", // sunset through a bare tree
  "grade-cool": "31213033", // winter mountains
  "grade-fade": "28610401", // layered pastel hills
  "grade-vintage": "14188003", // Corvair at a car show
  "grade-cyber": "30434898", // night city motion
  "colour-wash": "8894570", // pink flowers in a teapot
  "vignette-fade": "5077838", // moody mist forest
  "poster-pop": "533355", // fruit in a striped bowl
  // Glitch
  "vhs-glitch": "1366957", // skyline at night
  "crt-curve": "30691013", // night-bus passengers, b&w
  chromatic: "28993172", // rain window bokeh
  dispersion: "17806624", // neon-lit portrait
  vaporwave: "6562351", // illuminated arches at night
  "scanlines-rgb": "18462155", // night street on water
  "sine-warp": "12039507", // aerial rocky coastline
  warp: "26547201", // abstract window grid
  "pixel-grain": "19315391", // orange Moskvitch
  "pixel-dots": "31793882", // meerkat on a rock
  "pixel-diamonds": "33729670", // grapes in a blue bowl
  "mosaic-tiles": "17594273", // geometric facade
  lego: "10821202", // colorful fruit bowls
  crt: "35069718", // moody neon sign
};

const pexelsUrl = (id: string) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // keep the canvas exportable (pexels CDN)
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`image failed: ${src}`));
    img.src = src;
  });
}

type Row = { slug: string; status: "pending" | "ok" | "error"; note?: string };

export default function ThumbsClient() {
  const [rows, setRows] = useState<Row[]>(PRESETS.map((p) => ({ slug: p.slug, status: "pending" })));
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const fallback = await loadImage(FALLBACK_REFERENCE);
      const engine = new CpuEngine();
      const canvas = document.createElement("canvas");

      for (const preset of PRESETS) {
        try {
          const config: BgConfig = {
            version: 1,
            output: { aspect: "3:2", longEdge: W },
            source: { mode: "image", imageId: "reference", solidColor: "#cdd9e0" },
            stack: preset.build(),
          };
          if (preset.source?.mode === "pattern" && preset.source.pattern) {
            // Scene presets carry their own generative source.
            config.source = { mode: "pattern", imageId: null, solidColor: "#cdd9e0", pattern: preset.source.pattern };
            engine.setSource({ kind: "pattern", pattern: preset.source.pattern ?? DEFAULT_PATTERN });
          } else {
            const refId = PEXELS_REF[preset.slug];
            const img = refId ? await loadImage(pexelsUrl(refId)).catch(() => fallback) : fallback;
            engine.setSource({ kind: "image", image: img });
          }
          engine.render(canvas, config, { W, H });
          const dataUrl = canvas.toDataURL("image/webp", 0.9);
          const res = await fetch("/api/dev/thumbs", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: preset.slug, dataUrl }),
          });
          if (!res.ok) throw new Error(`write failed: ${res.status}`);
          setRows((r) => r.map((x) => (x.slug === preset.slug ? { ...x, status: "ok" } : x)));
        } catch (e) {
          setRows((r) =>
            r.map((x) => (x.slug === preset.slug ? { ...x, status: "error", note: String(e) } : x)),
          );
        }
      }
      engine.dispose();
      setDone(true);
    })();
  }, []);

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
          <li key={r.slug}>
            {r.status === "ok" ? "✓" : r.status === "error" ? "✗" : "·"} {r.slug}
            {r.note ? ` — ${r.note}` : ""}
          </li>
        ))}
      </ul>
      {errs.length > 0 && <p className="mt-4 text-red-600">{errs.length} failed</p>}
    </main>
  );
}
