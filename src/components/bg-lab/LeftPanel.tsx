"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CollapsibleSection } from "./panel";
import { SourcePanel } from "./SourcePanel";
import { DraftsPanel } from "./DraftsPanel";
import { ExportBar } from "./ExportBar";

/**
 * Left panel — the input/output lifecycle: what goes in (Source), what's kept
 * (Drafts), what comes out (Export drawer pinned at the bottom). The creative
 * loop (effects, presets) lives in the right panel.
 */
export function LeftPanel({
  width,
  collapsed,
  onToggle,
}: {
  width: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center border-r border-border-default bg-canvas pt-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls="left-panel-body"
          aria-label="Expand source panel"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col overflow-hidden bg-canvas">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-default pl-4 pr-2">
        <span className="font-nagel text-[18px] font-semibold tracking-[-0.01em] text-text-primary">
          Shader Lab
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-expanded
          aria-controls="left-panel-body"
          aria-label="Collapse source panel"
        >
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea id="left-panel-body" className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-3">
          <CollapsibleSection title="Source">
            <SourcePanel />
          </CollapsibleSection>
          <div className="border-t border-border-default pt-4">
            <CollapsibleSection title="Drafts" defaultOpen={false}>
              <DraftsPanel />
            </CollapsibleSection>
          </div>
        </div>
      </ScrollArea>

      <ExportBar />
    </aside>
  );
}
