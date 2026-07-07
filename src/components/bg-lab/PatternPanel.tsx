import { useEffect } from "react";
import type { ControlSpec } from "@/lib/bg-lab/catalog";
import type { PatternState, PatternType } from "@/lib/bg-lab/types";
import { DEFAULT_PATTERN } from "@/lib/bg-lab/patternCatalog";
import { cn } from "@/lib/utils";
import { useBgLab } from "./BgLabProvider";
import { ControlRow } from "./controls/ControlRow";
import { SectionHeader } from "./panel";

const PATTERN_TYPE_OPTIONS: { value: PatternType; label: string }[] = [
  { value: "dotGrid", label: "Dot grid" },
  { value: "graph", label: "Graph paper" },
  { value: "lineGrid", label: "Line grid" },
  { value: "plusGrid", label: "Plus grid" },
  { value: "halftoneGradient", label: "Halftone ramp" },
  { value: "stripes", label: "Stripes" },
  { value: "waves", label: "Waves" },
  { value: "rings", label: "Rings" },
  { value: "checker", label: "Checker" },
  { value: "iso", label: "Iso lattice" },
  { value: "moire", label: "Moiré" },
  { value: "hex", label: "Hex grid" },
  { value: "truchet", label: "Truchet" },
  { value: "voronoi", label: "Voronoi" },
  { value: "fbm", label: "Noise (fbm)" },
  { value: "clouds", label: "Clouds" },
  { value: "sky", label: "Sky" },
  { value: "caustics", label: "Caustics" },
];

// Controls only render for the types they affect — Angle on a dot grid or
// Stagger on rings were dead knobs that made the panel read untrustworthy.
// Generative fields repurpose knobs (see each draw's doc comment); they're
// listed here under whichever knob they actually read.
const APPLIES: Partial<Record<string, PatternType[]>> = {
  angle: ["stripes", "waves", "halftoneGradient", "moire", "fbm", "clouds", "sky", "caustics"],
  jitter: ["dotGrid", "iso", "plusGrid", "moire", "fbm", "clouds", "sky", "caustics"],
  stagger: ["dotGrid", "halftoneGradient", "voronoi", "caustics"],
};

const GEOMETRY: ControlSpec[] = [
  { kind: "slider", key: "cell", label: "Cell size", min: 4, max: 120, step: 1, default: DEFAULT_PATTERN.cell, unit: true },
  { kind: "slider", key: "weight", label: "Weight", min: 0.05, max: 0.95, step: 0.01, default: DEFAULT_PATTERN.weight },
  { kind: "slider", key: "angle", label: "Angle", min: -180, max: 180, step: 1, default: DEFAULT_PATTERN.angle },
  { kind: "slider", key: "jitter", label: "Jitter", min: 0, max: 0.5, step: 0.01, default: DEFAULT_PATTERN.jitter },
  { kind: "switch", key: "stagger", label: "Stagger rows", default: DEFAULT_PATTERN.stagger },
];

const INK: ControlSpec[] = [
  { kind: "color", key: "fg", label: "Foreground", default: DEFAULT_PATTERN.fg },
  { kind: "color", key: "bg", label: "Background", default: DEFAULT_PATTERN.bg },
];

// Per-type starting points, grounded in the physical reference for each
// pattern (notebook, blueprint, print ramp). Chips replace the whole state
// except the type itself.
const PATTERN_PRESETS: Partial<Record<PatternType, { name: string; patch: Partial<PatternState> }[]>> = {
  dotGrid: [
    { name: "Notebook", patch: { cell: 28, weight: 0.12, jitter: 0, stagger: false, fg: "#b9b6b0", bg: "#f5f4f1" } },
    { name: "Bold", patch: { cell: 36, weight: 0.4, jitter: 0, stagger: true, fg: "#1c1b19", bg: "#f1efec" } },
    { name: "Night", patch: { cell: 28, weight: 0.16, jitter: 0, stagger: false, fg: "#4c4a46", bg: "#141312" } },
  ],
  graph: [
    { name: "Engineer", patch: { cell: 18, weight: 0.08, fg: "#a9b4bd", bg: "#f6f5f2" } },
    { name: "Blueprint", patch: { cell: 20, weight: 0.1, fg: "#7d97b5", bg: "#10243a" } },
  ],
  plusGrid: [
    { name: "Registration", patch: { cell: 64, weight: 0.24, jitter: 0, fg: "#8f8c86", bg: "#f5f4f1" } },
    { name: "Scatter", patch: { cell: 48, weight: 0.18, jitter: 0.35, fg: "#1c1b19", bg: "#efedea" } },
  ],
  halftoneGradient: [
    { name: "Tint ramp", patch: { cell: 14, weight: 0.5, angle: 90, stagger: true, fg: "#1c1b19", bg: "#f1ece4" } },
    { name: "Riso red", patch: { cell: 16, weight: 0.55, angle: 45, stagger: true, fg: "#ff4b33", bg: "#f6f2ea" } },
  ],
  stripes: [
    { name: "Hairline", patch: { cell: 12, weight: 0.12, angle: 45, fg: "#c2bfb9", bg: "#f5f4f1" } },
    { name: "Awning", patch: { cell: 48, weight: 0.5, angle: 0, fg: "#2a2926", bg: "#f1efec" } },
  ],
  waves: [
    { name: "Topo", patch: { cell: 22, weight: 0.14, angle: 0, fg: "#a6a29b", bg: "#f5f4f1" } },
  ],
  clouds: [
    { name: "Fair day", patch: { cell: 42, weight: 0.35, jitter: 0.3, angle: 60, fg: "#f6f4ef", bg: "#a8c4dd" } },
    { name: "Dusk", patch: { cell: 48, weight: 0.45, jitter: 0.25, angle: -20, fg: "#e8c9a8", bg: "#3a3550" } },
  ],
  sky: [
    { name: "Golden hour", patch: { cell: 26, weight: 0.5, jitter: 0.35, angle: 20, fg: "#f3c98a", bg: "#7a9cc4" } },
    { name: "High noon", patch: { cell: 18, weight: 0.35, jitter: 0.2, angle: 80, fg: "#dce8f2", bg: "#4d7fc0" } },
  ],
  caustics: [
    { name: "Pool", patch: { cell: 52, weight: 0.3, jitter: 0.35, angle: 0, stagger: false, fg: "#dff3f6", bg: "#1e6f8e" } },
  ],
};

export function PatternPanel() {
  const { config, dispatch } = useBgLab();
  const pattern: PatternState = config.source.pattern ?? DEFAULT_PATTERN;

  // Initialize pattern state if it hasn't been set yet.
  useEffect(() => {
    if (!config.source.pattern) {
      dispatch({ t: "setSource", patch: { pattern: DEFAULT_PATTERN } });
    }
  }, [config.source.pattern, dispatch]);

  function set(key: keyof PatternState, value: PatternState[keyof PatternState]) {
    dispatch({ t: "setSource", patch: { pattern: { ...pattern, [key]: value } } });
  }
  function applyPreset(patch: Partial<PatternState>) {
    dispatch({ t: "setSource", patch: { pattern: { ...pattern, ...patch } } });
  }

  const typeSpec: ControlSpec = {
    kind: "select",
    key: "type",
    label: "Type",
    options: PATTERN_TYPE_OPTIONS,
    default: "dotGrid",
  };
  const presets = PATTERN_PRESETS[pattern.type];
  const geometry = GEOMETRY.filter((s) => {
    const gate = APPLIES[s.key];
    return !gate || gate.includes(pattern.type);
  });

  const row = (spec: ControlSpec) => (
    <ControlRow
      key={spec.key}
      spec={spec}
      value={pattern[spec.key as keyof PatternState] as Parameters<typeof ControlRow>[0]["value"]}
      onChange={(v) => set(spec.key as keyof PatternState, v as PatternState[keyof PatternState])}
    />
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader>Pattern</SectionHeader>
      <div className="flex flex-col gap-2.5">
        {row(typeSpec)}
        {presets && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((pr) => (
              <button
                key={pr.name}
                type="button"
                onClick={() => applyPreset(pr.patch)}
                className={cn(
                  "rounded-chip border border-border-default px-2.5 py-1 text-[11px] text-text-secondary transition-colors duration-150",
                  "hover:border-border-strong hover:bg-surface-hover hover:text-text-primary",
                )}
              >
                {pr.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-border-default pt-2.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">Geometry</span>
        {geometry.map(row)}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-border-default pt-2.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">Ink</span>
        {INK.map(row)}
      </div>
    </section>
  );
}
