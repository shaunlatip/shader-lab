import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { suggestDraftName } from "@/lib/bg-lab/library";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { labButton } from "./panel";

export function CanvasHeader() {
  const { config } = useBgLab();
  const { draftName, setDraftName, saveDraft, revertDraft, activeDraftId } = useLibrary();
  const suggested = suggestDraftName(config);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-canvas px-4">
      <div className="flex min-w-0 items-center gap-2">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          spellCheck={false}
          aria-label="Draft name"
          placeholder={suggested}
          className="min-w-0 max-w-[280px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-medium text-text-primary outline-none transition-colors placeholder:text-text-secondary hover:border-border-default focus:border-border-strong"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={labButton}
          onClick={() => {
            revertDraft();
            toast.success(activeDraftId ? "Reverted to last save" : "Reset to default");
          }}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
        </Button>
        <Button
          type="button"
          size="sm"
          className={cn("bg-text-primary text-canvas transition-[transform,background-color] duration-150 hover:bg-text-primary/90 active:scale-[0.98]")}
          onClick={() => {
            saveDraft(draftName);
            toast.success(activeDraftId ? "Draft updated" : "Draft saved", { description: draftName.trim() || suggested });
          }}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" /> {activeDraftId ? "Update draft" : "Save draft"}
        </Button>
      </div>
    </header>
  );
}
