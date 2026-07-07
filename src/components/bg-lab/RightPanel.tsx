"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AddEffectSearch } from "./AddEffectSearch";
import { EffectStack } from "./EffectStack";
import { SavedPanel } from "./SavedPanel";
import { AiConfigCard } from "./AiConfigCard";

/**
 * Right panel — the creative loop: add an effect, arrange the stack, reach
 * for presets, or ask the AI. Mirrors Figma/Paper's right-hand inspector.
 */
export function RightPanel({
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
      <aside className="flex w-11 shrink-0 flex-col items-center border-l border-border-default bg-canvas pt-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-expanded={false}
          aria-controls="right-panel-body"
          aria-label="Expand effects panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      </aside>
    );
  }

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col overflow-hidden bg-canvas">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-default pl-4 pr-2">
        <span className="text-[13px] font-medium text-text-primary">Effects</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggle}
          aria-expanded
          aria-controls="right-panel-body"
          aria-label="Collapse effects panel"
        >
          <PanelRightClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Add-search stays above the scroll region so its dropdown can overlay. */}
      <div className="shrink-0 border-b border-border-default p-3">
        <AddEffectSearch />
      </div>
      <ScrollArea id="right-panel-body" className="min-h-0 flex-1">
        <div className="flex flex-col gap-5 p-3">
          <EffectStack />
          <div className="border-t border-border-default pt-4">
            <SavedPanel />
          </div>
          <div className="border-t border-border-default pt-4">
            <AiConfigCard />
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
