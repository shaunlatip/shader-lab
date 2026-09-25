"use client";

import { useEffect, useRef, useState } from "react";
import { CpuEngine } from "@/lib/bg-lab/engine/cpu/cpuEngine";
import { presetBySlug } from "@/lib/bg-lab/presets";
import type { BgConfig } from "@/lib/bg-lab/types";

const W = 1200;
const H = 800; // 3:2 — the portfolio compare card's frame
const FPS = 30;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`frame failed: ${src}`));
    img.src = src;
  });
}

export default function RenderClient({ clip, preset, frames }: { clip: string; preset: string; frames: number }) {
  const [done, setDone] = useState(0);
  const [status, setStatus] = useState<"running" | "done" | "error">("running");
  const [note, setNote] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const p = presetBySlug(preset);
        if (!p) throw new Error(`unknown preset ${preset}`);
        const stack = p.build();
        const engine = new CpuEngine();
        const canvas = document.createElement("canvas");
        for (let i = 1; i <= frames; i++) {
          const name = String(i).padStart(4, "0");
          const img = await loadImage(`/dev-ref/render/${clip}/${name}.png`);
          const config: BgConfig = {
            version: 1,
            output: { aspect: "3:2", longEdge: W },
            source: { mode: "image", imageId: "frame", solidColor: "#000" },
            stack,
          };
          engine.setSource({ kind: "image", image: img });
          // Frame clock so animated grain moves as it does in the editor.
          engine.render(canvas, config, { W, H }, (i - 1) / FPS);
          const res = await fetch("/api/dev/render", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clip, frame: i, dataUrl: canvas.toDataURL("image/png") }),
          });
          if (!res.ok) throw new Error(`write failed at ${name}: ${res.status}`);
          setDone(i);
        }
        engine.dispose();
        setStatus("done");
      } catch (e) {
        setNote(String(e));
        setStatus("error");
      }
    })();
  }, [clip, preset, frames]);

  return (
    <main className="p-8 font-mono text-sm">
      <p data-render-status={status}>
        {clip} × {preset}: {status} {done}/{frames} {note}
      </p>
    </main>
  );
}
