"use client";

import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AddEffectSearch } from "./AddEffectSearch";
import { EffectStack } from "./EffectStack";
import { PresetGallery } from "./PresetGallery";
import { AiConfigCard } from "./AiConfigCard";

/**
 * Right panel — the creative loop: add an effect, arrange the stack, reach
 * for presets, or ask the AI. Mirrors Figma/Paper's right-hand inspector.
 * Collapse/expand is owned by the global header; collapsed renders nothing.
 */
export function RightPanel({
  width,
  collapsed,
  drawer = false,
}: {
  width: number;
  collapsed: boolean;
  /** Slide-over over the stage (narrow windows) instead of docked beside it. */
  drawer?: boolean;
}) {
  if (collapsed) return null;

  return (
    <aside
      style={{ width }}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-l border-border-default bg-canvas",
        // Leaves a 48px strip of scrim to tap-close on phones.
        drawer &&
          "absolute inset-y-0 right-0 z-40 max-w-[calc(100vw-48px)] shadow-5 motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200",
      )}
    >
      {/* Add-search stays above the scroll region so its dropdown can overlay. */}
      <div className="shrink-0 border-b border-border-default p-3">
        <AddEffectSearch />
      </div>
      <ScrollArea id="right-panel-body" className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-3">
          <div data-tour="effects">
            <EffectStack />
          </div>
          <div className="border-t border-border-default pt-4">
            <PresetGallery />
          </div>
          <div className="border-t border-border-default pt-4">
            <AiConfigCard />
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
