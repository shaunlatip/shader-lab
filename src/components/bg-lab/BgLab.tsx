import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePanelState } from "@/hooks/usePanelState";
import { BgLabProvider } from "./BgLabProvider";
import { SourceProvider } from "./SourceProvider";
import { LibraryProvider } from "./LibraryProvider";
import { LabHeader } from "./LabHeader";
import { LeftPanel } from "./LeftPanel";
import { RightPanel } from "./RightPanel";
import { PanelResizer } from "./PanelResizer";
import { Stage } from "./Stage";

function LabShell() {
  const left = usePanelState("left");
  const right = usePanelState("right");

  return (
    <div className="lab-chrome font-lab flex h-[100dvh] flex-col overflow-hidden bg-canvas text-text-primary antialiased">
      <LabHeader
        leftCollapsed={left.collapsed}
        rightCollapsed={right.collapsed}
        onToggleLeft={left.toggleCollapsed}
        onToggleRight={right.toggleCollapsed}
      />
      <div className="flex min-h-0 flex-1">
        <LeftPanel width={left.width} collapsed={left.collapsed} />
        {!left.collapsed && (
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
        {!right.collapsed && (
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
        <RightPanel width={right.width} collapsed={right.collapsed} />
      </div>
    </div>
  );
}

export default function BgLab() {
  return (
    <BgLabProvider>
      <SourceProvider>
        <LibraryProvider>
          <TooltipProvider delayDuration={200}>
            <LabShell />
          </TooltipProvider>
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
