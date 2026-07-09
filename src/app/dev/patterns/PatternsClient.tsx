"use client";

// Dev-only pattern parity harness. Renders every pattern type across each
// slider (Spacing / Thickness / Opacity / Rotation / Weight for the field
// types) so a single screenshot proves each control has the right effect on
// each pattern. Reachable at /dev/patterns in dev only (see page.tsx guard).

import { useEffect, useRef } from "react";
import { drawPattern } from "@/lib/bg-lab/engine/cpu/patterns";
import { DEFAULT_PATTERN } from "@/lib/bg-lab/patternCatalog";
import { PATTERN_TYPES, type PatternState } from "@/lib/bg-lab/types";

const W = 200;
const H = 130;

// dark ink on light paper so every stroke reads on a white page
const BASE: PatternState = { ...DEFAULT_PATTERN, fg: "#1c1b19", bg: "#f4f2ee", cell: 26, thickness: 1.5, opacity: 1 };

// Field/generative types read Weight, not Thickness — swap the "thickness"
// column for a "weight" sweep there so the harness exercises the live control.
const FIELD = new Set(["halftoneGradient", "voronoi", "fbm", "clouds", "sky", "caustics", "checker"]);

const VARIANTS: { label: string; patch: (t: string) => Partial<PatternState> }[] = [
  { label: "default", patch: () => ({}) },
  { label: "thick/weight", patch: (t) => (FIELD.has(t) ? { weight: 0.7 } : { thickness: 6 }) },
  { label: "spacing 70", patch: () => ({ cell: 70 }) },
  { label: "opacity .3", patch: () => ({ opacity: 0.3 }) },
  { label: "rotate 30", patch: () => ({ angle: 30 }) },
];

function Cell({ type, patch }: { type: PatternState["type"]; patch: Partial<PatternState> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    drawPattern(ctx, W, H, { ...BASE, type, ...patch }, 1);
  }, [type, patch]);
  return <canvas ref={ref} style={{ width: W, height: H, display: "block", borderRadius: 4 }} />;
}

export default function PatternsClient() {
  return (
    <main style={{ padding: 16, background: "#111", color: "#eee", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
      <h1 style={{ fontSize: 14, marginBottom: 12 }}>Pattern parity harness</h1>
      <table style={{ borderCollapse: "separate", borderSpacing: 6 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>type</th>
            {VARIANTS.map((v) => (
              <th key={v.label} style={{ textAlign: "left", fontWeight: 400, color: "#9aa" }}>{v.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PATTERN_TYPES.map((type) => (
            <tr key={type}>
              <td style={{ verticalAlign: "top", paddingTop: 4 }}>{type}</td>
              {VARIANTS.map((v) => (
                <td key={v.label}>
                  <Cell type={type} patch={v.patch(type)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
