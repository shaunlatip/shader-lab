"use client";

import { toast } from "sonner";
import { PanelLeft, PanelRight, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { suggestDraftName } from "@/lib/bg-lab/library";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { ThemeToggle } from "./ThemeToggle";
import { labButton } from "./panel";

/**
 * The one app header: wordmark + panel toggles on the left, file (draft)
 * name in the middle, theme/reset/save on the right. Spans the full window —
 * the panels and stage live in the row below, so nothing here shifts when
 * panels resize or collapse.
 */
export function LabHeader({
  leftCollapsed,
  rightCollapsed,
  onToggleLeft,
  onToggleRight,
}: {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}) {
  const { config } = useBgLab();
  const { draftName, setDraftName, saveDraft, revertDraft, activeDraftId } = useLibrary();
  const suggested = suggestDraftName(config);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border-default bg-canvas px-3">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleLeft}
          aria-expanded={!leftCollapsed}
          aria-label={leftCollapsed ? "Show source panel" : "Hide source panel"}
        >
          <PanelLeft className="h-4 w-4" />
        </Button>
        <span className="font-nagel text-[17px] font-semibold tracking-[-0.01em] text-text-primary">
          Shader Lab
        </span>
        <div className="mx-1 h-4 w-px shrink-0 bg-border-default" />
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          spellCheck={false}
          aria-label="Draft name"
          placeholder={suggested}
          className="min-w-[100px] max-w-[440px] flex-shrink rounded-control border border-transparent bg-transparent px-2 py-1 text-[13px] font-medium text-text-primary outline-none transition-colors [field-sizing:content] placeholder:text-text-secondary hover:border-border-default focus:border-border-strong"
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ThemeToggle />
        <div className="mx-0.5 h-4 w-px bg-border-default" />
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
          className={cn(
            "bg-text-primary text-canvas transition-[transform,background-color] duration-150 hover:bg-text-primary/90 active:scale-[0.98]",
          )}
          onClick={() => {
            saveDraft(draftName);
            toast.success(activeDraftId ? "Draft updated" : "Draft saved", {
              description: draftName.trim() || suggested,
            });
          }}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" /> {activeDraftId ? "Update draft" : "Save draft"}
        </Button>
        <div className="mx-0.5 h-4 w-px bg-border-default" />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleRight}
          aria-expanded={!rightCollapsed}
          aria-label={rightCollapsed ? "Show effects panel" : "Hide effects panel"}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
