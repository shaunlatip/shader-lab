"use client";

import { useState } from "react";
import { ImageDown } from "lucide-react";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBgLab } from "./BgLabProvider";
import { CollapsibleSection } from "./panel";
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
export function LeftPanel({ width, collapsed }: { width: number; collapsed: boolean }) {
  const { dispatch } = useBgLab();
  const [dragOver, setDragOver] = useState(false);

  if (collapsed) return null;

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const mode = file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : null;
    if (!mode) {
      toast.error("Unsupported file", { description: "Drop an image or video file." });
      return;
    }
    const url = URL.createObjectURL(file);
    dispatch({ t: "setSource", patch: { mode, imageId: url } });
  }

  return (
    <aside
      style={{ width }}
      onDragOver={(e) => {
        // Required for onDrop to fire at all; only react to actual files
        // (not e.g. an internal text/slider drag) so we don't flash the
        // overlay for unrelated drag interactions.
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the aside (not when it
        // moves between children, which also fires dragleave on the parent).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className="relative flex shrink-0 flex-col overflow-hidden border-r border-border-default bg-canvas"
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
