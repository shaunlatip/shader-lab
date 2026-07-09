"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { CollapsibleSection } from "./panel";
import { SourcePanel } from "./SourcePanel";
import { DraftsPanel } from "./DraftsPanel";
import { ExportBar } from "./ExportBar";

/**
 * Left panel — the input/output lifecycle: what goes in (Source), what's kept
 * (Drafts), what comes out (Export drawer pinned at the bottom). The creative
 * loop (effects, presets) lives in the right panel. Collapse/expand is owned
 * by the global header; a collapsed panel renders nothing.
 */
export function LeftPanel({ width, collapsed }: { width: number; collapsed: boolean }) {
  if (collapsed) return null;

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col overflow-hidden border-r border-border-default bg-canvas">
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
