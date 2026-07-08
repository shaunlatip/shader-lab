"use client";

import { toast } from "sonner";
import { Check, PanelLeft, PanelRight, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { suggestDraftName } from "@/lib/bg-lab/library";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { ThemeToggle } from "./ThemeToggle";
import { IconTip, labButton } from "./panel";

/**
 * The one app header: wordmark + panel toggles on the left, file (draft)
 * name true-centered in the full header width, theme/reset/save on the
 * right. Spans the full window — the panels and stage live in the row
 * below, so nothing here shifts when panels resize or collapse.
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
  const { draftName, setDraftName, saveDraft, revertDraft, activeDraftId, dirty } = useLibrary();
  const suggested = suggestDraftName(config);

  return (
    <header className="grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border-default bg-canvas px-3">
      <div className="flex min-w-0 items-center gap-2">
        <IconTip label={leftCollapsed ? "Show source panel" : "Hide source panel"} side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleLeft}
            aria-expanded={!leftCollapsed}
            aria-label={leftCollapsed ? "Show source panel" : "Hide source panel"}
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
        </IconTip>
        <span className="font-pixel text-[15px] text-text-primary">shaderlab</span>
      </div>
      {/* Centered in the full header width (not just the left group) via the
          grid's 1fr/auto/1fr columns — stays centered as the side groups
          change width across states (Save vs Update vs Saved). */}
      <input
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        spellCheck={false}
        aria-label="Draft name"
        placeholder={suggested}
        className="min-w-[100px] max-w-[440px] justify-self-center rounded-control border border-transparent bg-transparent px-2 py-1 text-center text-[13px] font-medium text-text-primary outline-none transition-colors [field-sizing:content] placeholder:text-text-secondary hover:border-border-default focus:border-border-strong"
      />
      <div className="flex shrink-0 items-center justify-end gap-2">
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
        {/* Save reflects the editor state: something to save (create or
            update) vs. everything saved (disabled, quiet). */}
        {dirty ? (
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
        ) : (
          <Button type="button" size="sm" variant="outline" disabled className={cn(labButton, "opacity-70")}>
            <Check className="mr-1.5 h-3.5 w-3.5" /> Saved
          </Button>
        )}
        <div className="mx-0.5 h-4 w-px bg-border-default" />
        <IconTip label={rightCollapsed ? "Show effects panel" : "Hide effects panel"} side="bottom">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleRight}
            aria-expanded={!rightCollapsed}
            aria-label={rightCollapsed ? "Show effects panel" : "Hide effects panel"}
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </IconTip>
      </div>
    </header>
  );
}
