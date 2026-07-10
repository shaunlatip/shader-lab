import { useEffect } from "react";
import { Shuffle } from "lucide-react";
import type { ControlSpec } from "@/lib/bg-lab/catalog";
import type { GradientState, GradientType } from "@/lib/bg-lab/types";
import { DEFAULT_GRADIENT, DEFAULT_MESH, GRADIENT_CONTROLS } from "@/lib/bg-lab/gradientCatalog";
import { cn } from "@/lib/utils";
import { useBgLab } from "./BgLabProvider";
import { ControlRow } from "./controls/ControlRow";
import { ColorField } from "./controls/ColorField";
import { RotationDial } from "./controls/RotationDial";
import { IconTip, SectionHeader } from "./panel";

const MESH_CORNER_LABEL = ["Top left", "Top right", "Bottom right", "Bottom left"];

// Which geometry knobs a gradient type actually reads — hiding dead knobs (a
// radius slider on a linear ramp) keeps the panel trustworthy, same rule as
// PatternPanel's APPLIES.
const APPLIES: Partial<Record<string, GradientType[]>> = {
  angle: ["linear", "conic", "warp"],
  cx: ["radial", "conic"],
  cy: ["radial", "conic"],
  radius: ["radial"],
  scale: ["warp"],
  warp: ["warp"],
  seed: ["warp", "reaction"],
  seamless: ["warp"],
  feed: ["reaction"],
  kill: ["reaction"],
};

// Curated starting points — each is a known-good Editions-adjacent ground. The
// ramps are two/three-stop OKLCH so midpoints stay luminous. Chips replace the
// whole state except the ramp geometry they name.
const GRADIENT_PRESETS: { name: string; patch: Partial<GradientState> }[] = [
  {
    name: "Dusk",
    patch: { type: "radial", cx: 0.35, cy: 0.3, radius: 0.9, stops: [{ t: 0, color: "#a56cf5" }, { t: 1, color: "#7a3ad6" }] },
  },
  {
    name: "Horizon",
    patch: { type: "linear", angle: 90, stops: [{ t: 0, color: "#2a1a4a" }, { t: 0.55, color: "#b45cc8" }, { t: 1, color: "#f0a6c8" }] },
  },
  {
    name: "Aurora",
    patch: { type: "conic", cx: 0.5, cy: 0.5, angle: -40, stops: [{ t: 0, color: "#3ad6c0" }, { t: 0.5, color: "#4a6cf5" }, { t: 1, color: "#3ad6c0" }] },
  },
  {
    name: "Cream",
    patch: { type: "linear", angle: 115, stops: [{ t: 0, color: "#f6efe2" }, { t: 1, color: "#e4d3b8" }] },
  },
  {
    name: "Ink",
    patch: { type: "radial", cx: 0.5, cy: 0.42, radius: 1.1, stops: [{ t: 0, color: "#3a4358" }, { t: 1, color: "#12151c" }] },
  },
  {
    name: "Peach",
    patch: { type: "radial", cx: 0.7, cy: 0.25, radius: 1.0, stops: [{ t: 0, color: "#ffcf9e" }, { t: 1, color: "#e86f8f" }] },
  },
  {
    name: "Vapor mesh",
    patch: { type: "mesh", mesh: ["#f0a6c8", "#a56cf5", "#3a2a6a", "#7a3ad6"] },
  },
  {
    name: "Sunset mesh",
    patch: { type: "mesh", mesh: ["#ffd39e", "#ff8f6b", "#8a3d78", "#3a2a6a"] },
  },
  {
    name: "Monet warp",
    patch: {
      type: "warp", scale: 3, warp: 0.6, angle: 30,
      stops: [{ t: 0, color: "#3a6ea5" }, { t: 0.5, color: "#a7c7e7" }, { t: 1, color: "#f3d9a8" }],
    },
  },
  {
    name: "Marble warp",
    patch: {
      type: "warp", scale: 4, warp: 0.9, angle: 0,
      stops: [{ t: 0, color: "#1a1a1e" }, { t: 0.5, color: "#6b6b73" }, { t: 1, color: "#f4f2ee" }],
    },
  },
  {
    name: "Coral",
    patch: {
      type: "reaction", feed: 0.037, kill: 0.06,
      stops: [{ t: 0, color: "#132a3a" }, { t: 0.5, color: "#2f8fb0" }, { t: 1, color: "#f0e9d8" }],
    },
  },
];

export function GradientPanel() {
  const { config, dispatch } = useBgLab();
  const gradient: GradientState = config.source.gradient ?? DEFAULT_GRADIENT;

  // Initialize gradient state if it hasn't been set yet.
  useEffect(() => {
    if (!config.source.gradient) {
      dispatch({ t: "setSource", patch: { gradient: DEFAULT_GRADIENT } });
    }
  }, [config.source.gradient, dispatch]);

  function set(key: keyof GradientState, value: GradientState[keyof GradientState]) {
    dispatch({ t: "setSource", patch: { gradient: { ...gradient, [key]: value } } });
  }
  function applyPreset(patch: Partial<GradientState>) {
    dispatch({ t: "setSource", patch: { gradient: { ...gradient, ...patch } } });
  }
  function setMeshCorner(i: number, hex: string) {
    const mesh = [...(gradient.mesh ?? DEFAULT_MESH)];
    mesh[i] = hex;
    set("mesh", mesh);
  }
  function randomize() {
    const pr = GRADIENT_PRESETS[Math.floor(Math.random() * GRADIENT_PRESETS.length)];
    applyPreset(pr.patch);
  }

  const typeSpec = GRADIENT_CONTROLS.find((s) => s.key === "type")!;
  const stopsSpec = GRADIENT_CONTROLS.find((s) => s.key === "stops")!;
  const geometry = GRADIENT_CONTROLS.filter((s) => {
    if (s.key === "type" || s.key === "stops") return false;
    const gate = APPLIES[s.key];
    return !gate || gate.includes(gradient.type);
  });
  const showDial = geometry.some((s) => s.key === "angle");
  const linearGeometry = geometry.filter((s) => s.key !== "angle");

  const row = (spec: ControlSpec) => (
    <ControlRow
      key={spec.key}
      spec={spec}
      value={gradient[spec.key as keyof GradientState] as Parameters<typeof ControlRow>[0]["value"]}
      onChange={(v) => set(spec.key as keyof GradientState, v as GradientState[keyof GradientState])}
    />
  );

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        action={
          <IconTip label="Random gradient">
            <button
              type="button"
              onClick={randomize}
              aria-label="Random gradient"
              className="grid h-6 w-6 place-items-center rounded-control text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <Shuffle className="h-3.5 w-3.5" />
            </button>
          </IconTip>
        }
      >
        Gradient
      </SectionHeader>
      <div className="flex flex-col gap-2.5">
        {row(typeSpec)}
        <div className="flex flex-wrap gap-1.5">
          {GRADIENT_PRESETS.map((pr) => (
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
      </div>
      {gradient.type === "mesh" ? (
        <div className="flex flex-col gap-2.5 border-t border-border-default pt-2.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">Corners · OKLab</span>
          <div className="grid grid-cols-2 gap-2">
            {MESH_CORNER_LABEL.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <ColorField
                  compact
                  value={(gradient.mesh ?? DEFAULT_MESH)[i]}
                  onChange={(hex) => setMeshCorner(i, hex)}
                />
                <span className="text-[10px] text-text-secondary">{label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          {geometry.length > 0 && (
            <div className="flex flex-col gap-2.5 border-t border-border-default pt-2.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">Geometry</span>
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-2.5">{linearGeometry.map(row)}</div>
                {showDial && (
                  <RotationDial
                    value={typeof gradient.angle === "number" ? gradient.angle : 0}
                    onChange={(v) => set("angle", v)}
                    className="shrink-0 pt-1"
                  />
                )}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2.5 border-t border-border-default pt-2.5">
            <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">Ramp · OKLCH</span>
            {row(stopsSpec)}
          </div>
        </>
      )}
    </section>
  );
}
