"use client";

import { ImageDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CollapsibleSection } from "./panel";
import { useSourceDrop } from "./useSourceDrop";
import { SourcePanel } from "./SourcePanel";
import { DraftsPanel } from "./DraftsPanel";
import { ExportBar } from "./ExportBar";

/**
 * Left panel — the input/output lifecycle: what goes in (Source), what's kept
 * (Drafts), what comes out (Export drawer pinned at the bottom). The creative
 * loop (effects, presets) lives in the right panel. Collapse/expand is owned
 * by the global header; a collapsed panel renders nothing.
 *
 * The whole panel is also a drop target: dragging an image/video file from
 * the OS anywhere onto this sidebar sets it as the source directly (same
 * object-URL path as the Upload buttons in SourcePanel), so you don't have to
 * hunt for the right sub-tab first.
 */
export function LeftPanel({
  width,
  collapsed,
  drawer = false,
}: {
  width: number;
  collapsed: boolean;
  /** Slide-over over the stage (narrow windows) instead of docked beside it. */
  drawer?: boolean;
}) {
  const { dragOver, dropHandlers } = useSourceDrop();

  if (collapsed) return null;

  return (
    <aside
      style={{ width }}
      {...dropHandlers}
      className={cn(
        "relative flex shrink-0 flex-col overflow-hidden border-r border-border-default bg-canvas",
        // Leaves a 48px strip of scrim to tap-close on phones.
        drawer &&
          "absolute inset-y-0 left-0 z-40 max-w-[calc(100vw-48px)] shadow-5 motion-safe:animate-in motion-safe:slide-in-from-left motion-safe:duration-200",
      )}
    >
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

      {dragOver && (
        <div className="pointer-events-none absolute inset-1.5 z-20 flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-text-primary bg-canvas/90 backdrop-blur-sm">
          <ImageDown className="h-6 w-6 text-text-primary" />
          <span className="text-[13px] font-medium text-text-primary">Drop to set as source</span>
        </div>
      )}
    </aside>
  );
}
