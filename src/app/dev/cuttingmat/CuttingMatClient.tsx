"use client";

// Dev-only cutting-mat parity harness. Overlays the lab's cuttingMat render
// (drawn in RED, multiply-blended) on top of each reference screenshot
// (public/dev-ref/cm-<spacing>.png) at matching aspect, so misalignment shows
// as red strokes that don't sit on the gray reference. One row per spacing.

import { useEffect, useRef } from "react";
import { drawPattern } from "@/lib/bg-lab/engine/cpu/patterns";
import { DEFAULT_PATTERN } from "@/lib/bg-lab/patternCatalog";
import type { PatternState } from "@/lib/bg-lab/types";

// reference images are 2518x2160 → aspect 1.166
const W = 780;
const H = Math.round((W * 2160) / 2518);
const SPACINGS = [200, 150, 100, 50, 10];

function Panel({ spacing }: { spacing: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    const p: PatternState = { ...DEFAULT_PATTERN, type: "cuttingMat", cell: spacing, thickness: 1.5, opacity: 1, fg: "#dd0000", bg: "#ffffff" };
    drawPattern(ctx, W, H, p, W / 1000);
  }, [spacing]);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#9aa", marginBottom: 2 }}>spacing {spacing}</div>
      <div style={{ position: "relative", width: W, height: H, outline: "1px solid #333" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/dev-ref/cm-${spacing}.png`} alt="" width={W} height={H} style={{ position: "absolute", inset: 0, opacity: 0.75 }} />
        <canvas ref={ref} style={{ position: "absolute", inset: 0, width: W, height: H, mixBlendMode: "multiply" }} />
      </div>
    </div>
  );
}

export default function CuttingMatClient() {
  return (
    <main style={{ padding: 16, background: "#111", color: "#eee", fontFamily: "ui-monospace, monospace" }}>
      <h1 style={{ fontSize: 14, marginBottom: 12 }}>Cutting-mat parity — red = lab render over gray reference</h1>
      {SPACINGS.map((s) => (
        <Panel key={s} spacing={s} />
      ))}
    </main>
  );
}
