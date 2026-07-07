"use client";

import { useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ColorPicker, parseColor } from "@/components/ui/color-picker/color-picker";
import { useSwatches } from "@/hooks/useSwatches";
import { cn } from "@/lib/utils";

/**
 * The lab's one color control: a chip trigger (swatch + hex) opening a
 * compact OKLCH picker popover (Amplo). Values stay 6-digit hex end-to-end —
 * effect params are validated as #rrggbb by the config schema, so alpha is
 * intentionally not exposed. Saved swatches are shared across all pickers.
 */
export function ColorField({
  value,
  onChange,
  className,
  compact = false,
}: {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
  /** Swatch-only trigger (no hex readout) for tight rows like gradient stops. */
  compact?: boolean;
}) {
  const { swatches, addSwatch } = useSwatches();
  const parsed = useMemo(() => parseColor(value) ?? parseColor("#808080")!, [value]);

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-7 items-center gap-2 rounded-control border border-border-default bg-canvas px-1.5 shadow-xs transition-[border-color,background-color] duration-150 hover:border-border-strong",
          className,
        )}
        aria-label="Choose color"
      >
        <span
          className="h-4.5 w-4.5 shrink-0 rounded-[4px] border border-black/10"
          style={{ background: value }}
        />
        {!compact && (
          <span className="font-mono text-[11px] uppercase leading-none text-text-secondary">
            {value}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="lab-chrome font-lab w-60 rounded-card border-border-default bg-canvas p-3 text-text-primary"
      >
        <ColorPicker.Root
          value={parsed}
          format="hex"
          formats={["hex"]}
          onValueChange={(_color, _formatted, formats) => {
            // Effect params are #rrggbb; hex serialization gamut-maps to sRGB.
            const hex = formats.hex.slice(0, 7).toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(hex)) onChange(hex);
          }}
          className="flex flex-col gap-2.5"
        >
          <ColorPicker.Area className="h-36 w-full rounded-control" />
          <div className="flex items-center gap-2">
            <ColorPicker.EyeDropper />
            <ColorPicker.Hue className="flex-1" />
          </div>
          <ColorPicker.CssInput className="h-7 font-mono text-[11px]" />
          <ColorPicker.Swatches
            presets={swatches}
            onAdd={(_c, hex) => addSwatch(hex.slice(0, 7))}
          />
        </ColorPicker.Root>
      </PopoverContent>
    </Popover>
  );
}
