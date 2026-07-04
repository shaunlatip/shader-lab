import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { SavedEffect } from "@/lib/bg-lab/library";
import { PRESET_GROUPS } from "@/lib/bg-lab/presets";
import { useLibrary } from "./LibraryProvider";
import { CollapsibleSection, labButton } from "./panel";

function Chip({ set, onApply, onRemove }: { set: SavedEffect; onApply: () => void; onRemove?: () => void }) {
  return (
    <div className="group/chip relative">
      <button
        type="button"
        onClick={onApply}
        title={`${set.name} — ${set.stack.length} effect${set.stack.length === 1 ? "" : "s"}`}
        className={cn(
          "max-w-full truncate rounded-full border border-border-default bg-canvas py-1 text-[12px] text-text-secondary transition-[transform,color,border-color,background-color] duration-150 ease-out hover:border-border-strong hover:bg-shade-9 hover:text-text-primary motion-safe:active:scale-[0.96]",
          onRemove ? "pl-3 pr-6" : "px-3",
        )}
      >
        {set.name}
      </button>
      {onRemove && (
        <button
          type="button"
          aria-label={`Delete ${set.name}`}
          onClick={onRemove}
          className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full text-text-secondary opacity-0 transition-opacity hover:text-text-primary group-hover/chip:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function SavedPanel() {
  const { saved, builtins, saveStack, applyStack, removeSaved } = useLibrary();
  const [name, setName] = useState("");

  function save() {
    saveStack(name);
    toast.success("Effect set saved", { description: name.trim() || "Untitled set" });
    setName("");
  }

  return (
    <CollapsibleSection title="Saved" defaultOpen>
      <div className="flex flex-col gap-3">
        {/* Save the live stack */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex gap-1.5"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Save current effects…"
            className="h-8 text-xs"
          />
          <button type="submit" aria-label="Save current effects" className={cn(labButton, "grid h-8 w-8 shrink-0 place-items-center rounded-md")}>
            <Plus className="h-4 w-4" />
          </button>
        </form>

        {saved.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-text-secondary">Your sets</span>
            <div className="flex flex-wrap gap-1.5">
              {saved.map((s) => (
                <Chip key={s.id} set={s} onApply={() => applyStack(s.stack)} onRemove={() => removeSaved(s.id)} />
              ))}
            </div>
          </div>
        )}

        {/* Built-in presets, clustered by group — a 40+ flat chip wall was
            unscannable; small headers give the eye somewhere to land. */}
        <div className="flex flex-col gap-2.5">
          {PRESET_GROUPS.map((g) => {
            const members = builtins.filter((s) => s.group === g);
            if (members.length === 0) return null;
            return (
              <div key={g} className="flex flex-col gap-1.5">
                <span className="text-[11px] text-text-secondary">{g}</span>
                <div className="flex flex-wrap gap-1.5">
                  {members.map((s) => (
                    <Chip key={s.id} set={s} onApply={() => applyStack(s.stack)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </CollapsibleSection>
  );
}
