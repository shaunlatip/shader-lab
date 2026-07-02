import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { GradientStop } from "@/lib/bg-lab/types";

export function GradientStops({
  stops,
  onChange,
}: {
  stops: GradientStop[];
  onChange: (s: GradientStop[]) => void;
}) {
  const sorted = [...stops].sort((a, b) => a.t - b.t);
  const css = `linear-gradient(90deg, ${sorted.map((s) => `${s.color} ${Math.round(s.t * 100)}%`).join(", ")})`;

  const update = (i: number, patch: Partial<GradientStop>) =>
    onChange(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const add = () => {
    if (stops.length >= 5) return;
    onChange([...stops, { t: 0.5, color: "#888888" }]);
  };
  const remove = (i: number) => {
    if (stops.length <= 2) return;
    onChange(stops.filter((_, idx) => idx !== i));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-text-secondary">Ramp</Label>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={add}
          disabled={stops.length >= 5}
          aria-label="Add stop"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="h-4 w-full rounded border border-border-default" style={{ background: css }} />
      <div className="flex flex-col gap-1.5">
        {stops.map((s, i) => (
          <div key={i} className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
            <input
              type="color"
              value={s.color}
              onChange={(e) => update(i, { color: e.target.value })}
              className="h-6 w-8 cursor-pointer rounded border border-border-default bg-transparent p-0"
            />
            <Slider value={[s.t]} min={0} max={1} step={0.01} onValueChange={(a) => update(i, { t: a[0] })} />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => remove(i)}
              disabled={stops.length <= 2}
              aria-label="Remove stop"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
