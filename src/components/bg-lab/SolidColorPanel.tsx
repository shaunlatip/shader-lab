import { useMemo } from "react";
import { ColorPicker, parseColor } from "@/components/ui/color-picker/color-picker";
import { useSwatches } from "@/hooks/useSwatches";
import { useBgLab } from "./BgLabProvider";
import { SectionHeader } from "./panel";

// Curated background swatches — neutrals across the value range plus a few
// useful tints (paper, cool, warm, navy).
const DEFAULT_SWATCHES = [
  "#ffffff", "#f4f1ea", "#e7e5e4", "#cdd9e0", "#a8b3bd", "#7a8691", "#44403c", "#0a0a0a",
  "#f3e2cf", "#e8c9a8", "#d8c4e0", "#b3befb", "#10243a", "#1a2233", "#2a1a14", "#0f1c14",
];

/**
 * Solid source color — the full inline picker (Amplo). Unlike the popover
 * ColorField on effect params, this surface has room for the complete
 * composition: area, hue, channel inputs, format readout, gamut badge.
 * Output stays 6-digit hex (the solid source is sRGB by definition).
 */
export function SolidColorPanel() {
  const { config, dispatch } = useBgLab();
  const color = config.source.solidColor;
  const set = (c: string) => dispatch({ t: "setSource", patch: { solidColor: c } });
  const { swatches, addSwatch } = useSwatches();

  const parsed = useMemo(() => parseColor(color) ?? parseColor("#ffffff")!, [color]);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader>Color</SectionHeader>

      <ColorPicker.Root
        value={parsed}
        defaultFormat="hex"
        formats={["hex", "rgb", "hsl", "oklch"]}
        onValueChange={(_color, _formatted, formats) => {
          const hex = formats.hex.slice(0, 7).toLowerCase();
          if (/^#[0-9a-f]{6}$/.test(hex) && hex !== color) set(hex);
        }}
        // inline surface: strip the Root's popover chrome + 280px cap so the
        // picker spans the panel
        className="max-w-none flex-col gap-2.5 rounded-none border-0 bg-transparent p-0 shadow-none"
      >
        <ColorPicker.Area className="h-40 w-full rounded-control" />
        <div className="flex items-center gap-2">
          <ColorPicker.Preview className="h-7 w-7 shrink-0 rounded-control" />
          <ColorPicker.EyeDropper />
          <ColorPicker.Hue className="flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <ColorPicker.FormatSwitcher className="h-7 shrink-0 text-[11px]" />
          <ColorPicker.ChannelInput showFormat={false} className="min-w-0 flex-1" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <ColorPicker.CssInput className="h-7 min-w-0 flex-1 font-mono text-[11px]" />
          <ColorPicker.GamutBadge showLabel className="shrink-0" />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-text-secondary">Swatches</span>
          <ColorPicker.Swatches presets={DEFAULT_SWATCHES} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-text-secondary">Yours</span>
          <ColorPicker.Swatches
            presets={swatches}
            onAdd={(_c, hex) => addSwatch(hex.slice(0, 7))}
          />
        </div>
      </ColorPicker.Root>
    </section>
  );
}
