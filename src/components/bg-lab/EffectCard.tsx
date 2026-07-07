import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Minus } from "@phosphor-icons/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  EFFECT_CATALOG,
  CONTROL_GROUP_LABEL,
  CONTROL_GROUP_ORDER,
  type ControlSpec,
} from "@/lib/bg-lab/catalog";
import type { Effect } from "@/lib/bg-lab/types";
import { useBgLab } from "./BgLabProvider";
import { ControlRow } from "./controls/ControlRow";

export function EffectCard({ effect }: { effect: Effect }) {
  const { dispatch } = useBgLab();
  const [open, setOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: effect.id });

  const meta = effect.type ? EFFECT_CATALOG[effect.type] : null;
  const style = { transform: CSS.Translate.toString(transform), transition };

  // hide rows gated by an unmet `showIf` (e.g. Glyphs only when charSet =
  // custom) and rows marked `hidden` (params that exist but aren't user knobs)
  const visible = (meta?.controls ?? []).filter(
    (c) => !c.hidden && (!c.showIf || c.showIf.in.includes(effect.params[c.showIf.key])),
  );
  const grouped = visible.some((c) => c.group);

  const row = (spec: ControlSpec) => (
    <ControlRow
      key={spec.key}
      spec={spec}
      value={effect.params[spec.key]}
      onChange={(v) => dispatch({ t: "setParam", id: effect.id, key: spec.key, value: v })}
    />
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/card rounded-card border border-border-default bg-canvas transition-[opacity,box-shadow,border-color] duration-150 ease-out",
        isDragging ? "z-10 opacity-90 shadow-3" : "hover:border-border-strong",
        !effect.enabled && "opacity-55",
      )}
    >
      {/* The whole header row is the drag handle (hold anywhere and move —
          no grip icon; the 4px sensor activation keeps plain clicks working).
          Keyboard reorder keeps working through the sortable attributes on
          this row (space to lift, arrows to move). */}
      <div
        className="flex touch-none items-center gap-1 px-1.5 py-1.5"
        {...attributes}
        {...listeners}
      >
        {/* Static label — type is chosen at add-time via the search field, so
            the card itself carries no dropdown. Click anywhere on the label to
            expand the controls. */}
        <button
          type="button"
          onClick={() => meta && setOpen((o) => !o)}
          disabled={!meta}
          className="group/label flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-text-secondary transition-transform duration-200 ease-out group-hover/label:text-text-primary",
              open && "rotate-90",
            )}
          />
          <span className="truncate font-nagel text-[15px] font-medium leading-none text-text-primary">
            {meta ? meta.label : "Empty"}
          </span>
        </button>

        <Switch
          checked={effect.enabled}
          onCheckedChange={() => dispatch({ t: "toggle", id: effect.id })}
          aria-label="Toggle effect"
        />

        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => dispatch({ t: "remove", id: effect.id })}
          aria-label="Remove effect"
          className="text-text-secondary transition-[transform,color] duration-150 hover:text-text-primary active:scale-90"
        >
          <Minus className="h-4 w-4" />
        </Button>
      </div>

      {open && meta && (
        <div className="flex animate-in flex-col gap-3 border-t border-border-default px-3 pb-3 pt-2.5 duration-150 ease-out fade-in-0 slide-in-from-top-1">
          {!grouped ? (
            <div className="flex flex-col gap-2.5">{visible.map(row)}</div>
          ) : (
            <>
              {/* ungrouped rows (if any) sit above the sections */}
              {visible.some((c) => !c.group) && (
                <div className="flex flex-col gap-2.5">{visible.filter((c) => !c.group).map(row)}</div>
              )}
              {CONTROL_GROUP_ORDER.map((g) => {
                const rows = visible.filter((c) => c.group === g);
                if (!rows.length) return null;

                if (g === "advanced") {
                  return (
                    <div key={g} className="flex flex-col gap-2.5 border-t border-border-default pt-2.5">
                      <button
                        type="button"
                        onClick={() => setAdvOpen((o) => !o)}
                        className="group/adv flex items-center gap-1 text-left"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 shrink-0 text-text-secondary transition-transform duration-200 ease-out",
                            advOpen && "rotate-90",
                          )}
                        />
                        <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                          {meta.groupLabels?.[g] ?? CONTROL_GROUP_LABEL[g]}
                        </span>
                      </button>
                      {advOpen && <div className="flex flex-col gap-2.5">{rows.map(row)}</div>}
                    </div>
                  );
                }

                return (
                  <div key={g} className="flex flex-col gap-2.5">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                      {meta.groupLabels?.[g] ?? CONTROL_GROUP_LABEL[g]}
                    </span>
                    {rows.map(row)}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
