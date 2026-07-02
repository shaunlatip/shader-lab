import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "./panel";
import { useBgLab } from "./BgLabProvider";

// Curated background swatches — neutrals across the value range plus a few
// useful tints (paper, cool, warm, navy).
const SWATCHES = [
  "#ffffff", "#f4f1ea", "#e7e5e4", "#cdd9e0", "#a8b3bd", "#7a8691", "#44403c", "#0a0a0a",
  "#f3e2cf", "#e8c9a8", "#d8c4e0", "#b3befb", "#10243a", "#1a2233", "#2a1a14", "#0f1c14",
];

const HEX = /^#?[0-9a-fA-F]{6}$/;

export function SolidColorPanel() {
  const { config, dispatch } = useBgLab();
  const color = config.source.solidColor;
  const set = (c: string) => dispatch({ t: "setSource", patch: { solidColor: c } });

  const [hex, setHex] = useState(color);
  useEffect(() => setHex(color), [color]);

  function commitHex(value: string) {
    if (HEX.test(value)) set((value.startsWith("#") ? value : `#${value}`).toLowerCase());
    else setHex(color); // revert invalid input
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader>Color</SectionHeader>

      {/* Large preview — clicking anywhere opens the OS color picker. */}
      <label className="relative block h-20 w-full overflow-hidden rounded-md border border-border-default">
        <span className="absolute inset-0" style={{ backgroundColor: color }} />
        <input
          type="color"
          value={color}
          onChange={(e) => set(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Pick a color"
        />
      </label>

      {/* Hex field */}
      <div className="grid grid-cols-[40px_1fr] items-center gap-2">
        <span className="text-[11px] text-text-secondary">Hex</span>
        <div className="flex items-center gap-1.5 rounded-md border border-border-default bg-canvas px-2.5 py-1.5 focus-within:border-border-strong">
          <span className="text-text-secondary">#</span>
          <input
            value={hex.replace(/^#/, "")}
            onChange={(e) => setHex(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            spellCheck={false}
            maxLength={6}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase text-text-primary outline-none"
          />
        </div>
      </div>

      {/* Swatches */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-text-secondary">Swatches</span>
        <div className="grid grid-cols-8 gap-1.5">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              title={s}
              onClick={() => set(s)}
              className={cn(
                "aspect-square rounded-md border transition-[transform,border-color] duration-150 ease-out motion-safe:active:scale-90",
                color.toLowerCase() === s
                  ? "border-text-primary"
                  : "border-black/10 hover:border-border-strong",
              )}
              style={{ backgroundColor: s }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
