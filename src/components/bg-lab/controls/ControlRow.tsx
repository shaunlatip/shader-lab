import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ControlSpec } from "@/lib/bg-lab/catalog";
import type { GradientStop, ParamValue } from "@/lib/bg-lab/types";
import { ColorField } from "./ColorField";
import { GradientStops } from "./GradientStops";

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export function ControlRow({
  spec,
  value,
  onChange,
}: {
  spec: ControlSpec;
  value: ParamValue;
  onChange: (v: ParamValue) => void;
}) {
  if (spec.kind === "slider") {
    const v = typeof value === "number" ? value : spec.default;
    return (
      <div className="grid grid-cols-[84px_1fr_40px] items-center gap-2">
        <Label className="text-xs text-text-secondary">{spec.label}</Label>
        <Slider
          value={[v]}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onValueChange={(arr) => onChange(arr[0])}
        />
        <span className="text-right font-mono text-[11px] tabular-nums text-text-primary">{fmt(v)}</span>
      </div>
    );
  }

  if (spec.kind === "switch") {
    const v = typeof value === "boolean" ? value : spec.default;
    return (
      <div className="flex items-center justify-between">
        <Label className="text-xs text-text-secondary">{spec.label}</Label>
        <Switch checked={v} onCheckedChange={(c) => onChange(c)} />
      </div>
    );
  }

  if (spec.kind === "select") {
    const v = typeof value === "string" ? value : spec.default;
    return (
      <div className="grid grid-cols-[84px_1fr] items-center gap-2">
        <Label className="text-xs text-text-secondary">{spec.label}</Label>
        <Select value={v} onValueChange={(nv) => onChange(nv)}>
          <SelectTrigger size="sm" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="lab-chrome font-lab border-border-default bg-canvas text-text-primary">
            {spec.options.map((o) => (
              <SelectItem
                key={o.value}
                value={o.value}
                className="text-xs focus:bg-canvas-inverted/10 focus:text-text-primary"
              >
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (spec.kind === "color") {
    const v = typeof value === "string" ? value : spec.default;
    return (
      <div className="grid grid-cols-[84px_1fr] items-center gap-2">
        <Label className="text-xs text-text-secondary">{spec.label}</Label>
        <ColorField value={v} onChange={onChange} className="w-fit" />
      </div>
    );
  }

  if (spec.kind === "text") {
    const v = typeof value === "string" ? value : spec.default;
    return (
      <div className="grid grid-cols-[84px_1fr] items-center gap-2">
        <Label className="text-xs text-text-secondary">{spec.label}</Label>
        <input
          type="text"
          value={v}
          maxLength={spec.maxLen ?? 200}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="h-8 w-full rounded border border-border-default bg-canvas px-2 font-mono text-[11px] text-text-primary focus:border-text-secondary focus:outline-none"
        />
      </div>
    );
  }

  // gradient
  return (
    <GradientStops
      stops={Array.isArray(value) ? (value as GradientStop[]) : spec.default}
      onChange={(s) => onChange(s)}
    />
  );
}
