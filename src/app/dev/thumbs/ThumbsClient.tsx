"use client";

import { useEffect, useRef, useState } from "react";
import { CpuEngine } from "@/lib/bg-lab/engine/cpu/cpuEngine";
import { PRESETS } from "@/lib/bg-lab/presets";
import type { BgConfig } from "@/lib/bg-lab/types";

const W = 640;
const H = 427; // 3:2, matches the app's default aspect
const REFERENCE = "/presets/_reference.png";

type Row = { slug: string; status: "pending" | "ok" | "error"; note?: string };

export default function ThumbsClient() {
  const [rows, setRows] = useState<Row[]>(PRESETS.map((p) => ({ slug: p.slug, status: "pending" })));
  const [done, setDone] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      const img = new Image();
      img.src = REFERENCE;
      await img.decode();

      const engine = new CpuEngine();
      engine.setSource({ kind: "image", image: img });
      const canvas = document.createElement("canvas");

      for (const preset of PRESETS) {
        try {
          const config: BgConfig = {
            version: 1,
            output: { aspect: "3:2", longEdge: W },
            source: { mode: "image", imageId: "reference", solidColor: "#cdd9e0" },
            stack: preset.build(),
          };
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
