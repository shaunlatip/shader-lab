import { useEffect } from "react";
import { DEFAULT_PATTERN, PATTERN_CONTROLS } from "@/lib/bg-lab/patternCatalog";
import type { PatternState } from "@/lib/bg-lab/types";
import { useBgLab } from "./BgLabProvider";
import { ControlRow } from "./controls/ControlRow";
import { SectionHeader } from "./panel";

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
