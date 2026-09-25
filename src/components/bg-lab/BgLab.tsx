import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePanelState, type PanelSide } from "@/hooks/usePanelState";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { BgLabProvider } from "./BgLabProvider";
import { SourceProvider } from "./SourceProvider";
import { LibraryProvider } from "./LibraryProvider";
import { LabHeader } from "./LabHeader";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { PanelResizer } from "./PanelResizer";
import { Stage } from "./Stage";
import { OnboardingProvider } from "./OnboardingProvider";
import { Tour } from "./Tour";

// Below these widths a panel stops docking beside the stage and becomes a
// slide-over drawer (closed by default), so the artwork keeps a usable width.
// Source goes first — it's the setup step; the effects panel is the creative
// loop and stays docked longer.
const DOCK_LEFT = "(min-width: 1200px)";
const DOCK_RIGHT = "(min-width: 900px)";

function LabShell() {
  const left = usePanelState("left");
  const right = usePanelState("right");
  const dockLeft = useMediaQuery(DOCK_LEFT);
  const dockRight = useMediaQuery(DOCK_RIGHT);
  // One drawer at a time; only meaningful for an undocked side. Not persisted
  // — a narrow window always opens on the artwork.
  const [drawer, setDrawer] = useState<PanelSide | null>(null);
  const leftDrawer = !dockLeft && drawer === "left";
  const rightDrawer = !dockRight && drawer === "right";
  const toggleDrawer = (side: PanelSide) => setDrawer((d) => (d === side ? null : side));

  // Esc closes an open drawer.
  useEffect(() => {
    if (!leftDrawer && !rightDrawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leftDrawer, rightDrawer]);

  return (
    <div className="lab-chrome font-lab flex h-[100dvh] flex-col overflow-hidden bg-canvas text-text-primary antialiased">
      <LabHeader
        leftCollapsed={dockLeft ? left.collapsed : !leftDrawer}
        rightCollapsed={dockRight ? right.collapsed : !rightDrawer}
        onToggleLeft={dockLeft ? left.toggleCollapsed : () => toggleDrawer("left")}
        onToggleRight={dockRight ? right.toggleCollapsed : () => toggleDrawer("right")}
      />
      <div className="relative flex min-h-0 flex-1">
        {dockLeft && <LeftPanel width={left.width} collapsed={left.collapsed} />}
        {dockLeft && !left.collapsed && (
          <PanelResizer
            side="left"
            width={left.width}
            min={left.min}
            max={left.max}
            collapsed={left.collapsed}
            onWidth={left.setWidth}
            onToggle={left.toggleCollapsed}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <Stage />
        </main>
        {dockRight && !right.collapsed && (
          <PanelResizer
            side="right"
            width={right.width}
            min={right.min}
            max={right.max}
            collapsed={right.collapsed}
            onWidth={right.setWidth}
            onToggle={right.toggleCollapsed}
          />
        )}
        {dockRight && <RightPanel width={right.width} collapsed={right.collapsed} />}

        {/* Drawers: slide over the stage with a light scrim (tap it or press
            Esc to close). Kept light so preset changes stay visible behind. */}
        {(leftDrawer || rightDrawer) && (
          <div aria-hidden className="absolute inset-0 z-30 bg-black/15" onClick={() => setDrawer(null)} />
        )}
        {leftDrawer && <LeftPanel width={left.width} collapsed={false} drawer />}
        {rightDrawer && <RightPanel width={right.width} collapsed={false} drawer />}
      </div>
      <Tour />
    </div>
  );
}

export default function BgLab() {
  return (
    <BgLabProvider>
      <SourceProvider>
        <LibraryProvider>
          <OnboardingProvider>
            <TooltipProvider delayDuration={200}>
              <LabShell />
            </TooltipProvider>
          </OnboardingProvider>
        </LibraryProvider>
        <Toaster
          position="bottom-right"
          className="font-lab"
          style={
            {
              "--normal-bg": "var(--color-canvas-elevated)",
              "--normal-text": "var(--color-text-primary)",
              "--normal-border": "var(--color-border-default)",
            } as React.CSSProperties
          }
        />
      </SourceProvider>
    </BgLabProvider>
  );
}
