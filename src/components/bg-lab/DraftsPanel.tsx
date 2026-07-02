import { toast } from "sonner";
import { CopyPlus, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { suggestDraftName } from "@/lib/bg-lab/library";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { labButton } from "./panel";

function describe(stackLen: number, aspect: unknown) {
  const a = typeof aspect === "string" ? aspect : "custom";
  return `${stackLen} effect${stackLen === 1 ? "" : "s"} · ${a}`;
}

export function DraftsPanel() {
  const { config } = useBgLab();
  const { drafts, draftName, setDraftName, saveDraft, saveAsNewDraft, loadDraft, removeDraft, activeDraftId } =
    useLibrary();
  const suggested = suggestDraftName(config);
  // The active draft is the one being edited (shown in the header) — exclude it.
  const list = drafts.filter((d) => d.id !== activeDraftId);

  function save() {
    saveDraft(draftName);
    toast.success(activeDraftId ? "Draft updated" : "Draft saved", { description: draftName.trim() || suggested });
  }
  function saveNew() {
    saveAsNewDraft(draftName);
    toast.success("Saved as new draft", { description: draftName.trim() || suggested });
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex gap-1.5"
      >
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={suggested}
          className="h-8 min-w-0 flex-1 text-xs"
        />
        <button
          type="submit"
          aria-label={activeDraftId ? "Update draft" : "Save draft"}
          title={activeDraftId ? "Update draft" : "Save draft"}
          className={cn(labButton, "grid h-8 w-8 shrink-0 place-items-center rounded-md")}
        >
          <Plus className="h-4 w-4" />
        </button>
        {activeDraftId && (
          <button
            type="button"
            onClick={saveNew}
            aria-label="Save as new draft"
            title="Save as new draft"
            className={cn(labButton, "grid h-8 w-8 shrink-0 place-items-center rounded-md")}
          >
            <CopyPlus className="h-4 w-4" />
          </button>
        )}
      </form>

      {list.length === 0 ? (
        <p className="rounded-md border border-dashed border-border-default px-3 py-8 text-center text-[12px] leading-relaxed text-text-secondary">
          {activeDraftId ? "No other drafts." : "No drafts yet."}
          <br />
          Save the current image + effects above.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map((d) => (
            <div
              key={d.id}
              className="group/draft flex items-center gap-2 rounded-md border border-border-default bg-canvas p-2 transition-colors hover:border-border-strong"
            >
              <button type="button" onClick={() => loadDraft(d.id)} className="flex min-w-0 flex-1 flex-col items-start text-left">
                <span className="w-full truncate text-[13px] font-medium text-text-primary">{d.name}</span>
                <span className="text-[11px] text-text-secondary">{describe(d.config.stack.length, d.config.output.aspect)}</span>
              </button>
              <button
                type="button"
                aria-label={`Delete ${d.name}`}
                onClick={() => removeDraft(d.id)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-secondary opacity-0 transition-[opacity,color] hover:text-text-primary group-hover/draft:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
