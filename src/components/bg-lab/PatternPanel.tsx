import { useEffect } from "react";
import type { ControlSpec } from "@/lib/bg-lab/catalog";
import type { PatternState, PatternType } from "@/lib/bg-lab/types";
import { DEFAULT_PATTERN } from "@/hooks/useImageSource";
import { useBgLab } from "./BgLabProvider";
import { ControlRow } from "./controls/ControlRow";
import { SectionHeader } from "./panel";

const PATTERN_TYPE_OPTIONS: { value: PatternType; label: string }[] = [
  { value: "dotGrid", label: "Dot grid" },
  { value: "lineGrid", label: "Line grid" },
  { value: "checker", label: "Checker" },
  { value: "stripes", label: "Stripes" },
  { value: "rings", label: "Rings" },
  { value: "iso", label: "Iso lattice" },
  { value: "moire", label: "Moiré" },
  { value: "hex", label: "Hex grid" },
  { value: "truchet", label: "Truchet" },
  { value: "voronoi", label: "Voronoi" },
  { value: "fbm", label: "Noise (fbm)" },
];

const PATTERN_CONTROLS: ControlSpec[] = [
  {
    kind: "select",
    key: "type",
    label: "Type",
    options: PATTERN_TYPE_OPTIONS,
    default: "dotGrid",
  },
  {
    kind: "slider",
    key: "cell",
    label: "Cell size",
    min: 4,
    max: 120,
    step: 1,
    default: DEFAULT_PATTERN.cell,
    unit: true,
  },
  {
    kind: "slider",
    key: "weight",
    label: "Weight",
    min: 0.05,
    max: 0.95,
    step: 0.01,
    default: DEFAULT_PATTERN.weight,
  },
  {
    kind: "slider",
    key: "jitter",
    label: "Jitter",
    min: 0,
    max: 0.5,
    step: 0.01,
    default: DEFAULT_PATTERN.jitter,
  },
  {
    kind: "slider",
    key: "angle",
    label: "Angle",
    min: -180,
    max: 180,
    step: 1,
    default: DEFAULT_PATTERN.angle,
  },
  {
    kind: "switch",
    key: "stagger",
    label: "Stagger rows",
    default: DEFAULT_PATTERN.stagger,
  },
  {
    kind: "color",
    key: "fg",
    label: "Foreground",
    default: DEFAULT_PATTERN.fg,
  },
  {
    kind: "color",
    key: "bg",
    label: "Background",
    default: DEFAULT_PATTERN.bg,
  },
];

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

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader>Pattern</SectionHeader>
      <div className="flex flex-col gap-2.5">
        {PATTERN_CONTROLS.map((spec) => (
          <ControlRow
            key={spec.key}
            spec={spec}
            value={pattern[spec.key as keyof PatternState] as Parameters<typeof ControlRow>[0]["value"]}
            onChange={(v) => set(spec.key as keyof PatternState, v as PatternState[keyof PatternState])}
          />
        ))}
      </div>
    </section>
  );
}
