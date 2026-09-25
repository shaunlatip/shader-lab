"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Check, ChevronDown, CircleHelp, ClipboardCopy, PanelLeft, PanelRight, RotateCcw, Save } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { suggestDraftName } from "@/lib/bg-lab/library";
import { buildSpec } from "@/lib/bg-lab/spec";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { useOnboarding } from "./OnboardingProvider";
import { useEngineSource } from "./SourceProvider";
import { ThemeToggle } from "./ThemeToggle";
import { IconTip, labButton } from "./panel";

// Same item treatment as the lab's Select items (ExportBar's SELECT_ITEM).
const MENU_ITEM = "cursor-pointer text-text-primary focus:bg-canvas-inverted/10 focus:text-text-primary";

/** Labeled button on wide screens; icon-only with the label as a tooltip
 * when compact (every icon-only button gets a tooltip). */
function HeaderAction({ compact, label, children }: { compact: boolean; label: string; children: ReactNode }) {
  if (!compact) return <>{children}</>;
  return (
    <IconTip label={label} side="bottom">
      {children}
    </IconTip>
  );
}

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
  const { startTour } = useOnboarding();
  const compact = useMediaQuery("(max-width: 767px)");
  const { engineSource } = useEngineSource();

  async function copySpec() {
    // Playback isn't part of the config but decides which frame is on screen.
    const v = engineSource?.kind === "video" ? engineSource.video : null;
    const im = engineSource?.kind === "image" && engineSource.image instanceof HTMLImageElement ? engineSource.image : null;
    const spec = buildSpec(config, {
      name: draftName.trim() || suggested,
      video: v
        ? { time: v.currentTime, duration: v.duration || 0, rate: v.playbackRate, paused: v.paused, loop: v.loop }
        : null,
      sourceSize: v ? { w: v.videoWidth, h: v.videoHeight } : im ? { w: im.naturalWidth, h: im.naturalHeight } : null,
    });
    try {
      await navigator.clipboard.writeText(spec);
      toast.success("Spec copied", { description: "Paste it to an agent to reproduce this look exactly." });
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  }

  return (
    // Wide: 1fr/auto/1fr so the draft name is true-centered. Narrower, the side
    // groups can outgrow a 1fr share, so the name takes the flexible middle
    // column instead (and hides on phones, where the actions are icon-only).
    <header className="grid h-12 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border-default bg-canvas px-3 lg:grid-cols-[1fr_auto_1fr] lg:gap-3">
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
        <span className="font-logo text-[15px] text-text-primary">shaderlab</span>
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
        className="min-w-[100px] max-w-[min(440px,100%)] justify-self-center truncate rounded-control border border-transparent bg-transparent px-2 py-1 text-center text-[13px] font-medium text-text-primary outline-none transition-colors [field-sizing:content] placeholder:text-text-secondary hover:border-border-default focus:border-border-strong max-sm:invisible max-sm:w-0 max-sm:min-w-0 max-sm:px-0"
      />
      <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-2">
        <IconTip label="Quick tour" side="bottom">
          <Button variant="ghost" size="icon-sm" onClick={startTour} aria-label="Start the quick tour">
            <CircleHelp className="h-4 w-4" />
          </Button>
        </IconTip>
        <ThemeToggle />
        <div className="mx-0.5 h-4 w-px bg-border-default max-md:hidden" />
        <HeaderAction compact={compact} label={activeDraftId ? "Revert to last save" : "Reset to default"}>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(labButton, compact && "px-2")}
            aria-label={compact ? "Reset" : undefined}
            onClick={() => {
              revertDraft();
              toast.success(activeDraftId ? "Reverted to last save" : "Reset to default");
            }}
          >
            <RotateCcw className="h-3.5 w-3.5 md:mr-1.5" /> {!compact && "Reset"}
          </Button>
        </HeaderAction>
        {/* Split button. The main segment reflects the editor state: something
            to save (create or update) vs. everything saved (disabled, quiet).
            The chevron stays live in both states — Copy spec works on saved
            and unsaved looks alike. Icon-only below md, label in a tooltip. */}
        <div className="flex items-center">
          {dirty ? (
            <HeaderAction compact={compact} label={activeDraftId ? "Update" : "Save"}>
              <Button
                type="button"
                size="sm"
                aria-label={compact ? (activeDraftId ? "Update" : "Save") : undefined}
                className={cn(
                  "rounded-r-none bg-text-primary text-canvas transition-[transform,background-color] duration-150 hover:bg-text-primary/90 active:scale-[0.98]",
                  compact && "px-2",
                )}
                onClick={() => {
                  saveDraft(draftName);
                  toast.success(activeDraftId ? "Updated" : "Saved", {
                    description: draftName.trim() || suggested,
                  });
                }}
              >
                <Save className="h-3.5 w-3.5 md:mr-1.5" /> {!compact && (activeDraftId ? "Update" : "Save")}
              </Button>
            </HeaderAction>
          ) : (
            <HeaderAction compact={compact} label="Saved">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled
                aria-label={compact ? "Saved" : undefined}
                className={cn(labButton, "rounded-r-none text-text-secondary disabled:opacity-100", compact && "px-2")}
              >
                <Check className="h-3.5 w-3.5 md:mr-1.5" /> {!compact && "Saved"}
              </Button>
            </HeaderAction>
          )}
          <DropdownMenu>
            <IconTip label="More save options" side="bottom">
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant={dirty ? "default" : "outline"}
                  aria-label="More save options"
                  className={cn(
                    "w-7 rounded-l-none px-0",
                    dirty
                      ? "border-l border-canvas/25 bg-text-primary text-canvas hover:bg-text-primary/90"
                      : cn(labButton, "-ml-px"),
                  )}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </IconTip>
            <DropdownMenuContent align="end" className="lab-chrome font-lab w-64 border-border-default bg-canvas">
              <DropdownMenuItem className={MENU_ITEM} onSelect={copySpec}>
                <ClipboardCopy className="mt-0.5 h-3.5 w-3.5 self-start text-text-secondary" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium">Copy spec</span>
                  <span className="text-[11px] leading-snug text-text-secondary">
                    Source, crop, output size, and every effect setting as Markdown + JSON, for handing off to an agent.
                  </span>
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mx-0.5 h-4 w-px bg-border-default max-md:hidden" />
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
