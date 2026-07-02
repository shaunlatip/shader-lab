import { useEffect, useRef, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BgLabProvider } from "./BgLabProvider";
import { SourceProvider } from "./SourceProvider";
import { LibraryProvider } from "./LibraryProvider";
import { CanvasHeader } from "./CanvasHeader";
import { Sidebar } from "./Sidebar";
import { Stage } from "./Stage";

const MIN_W = 300;
const MAX_W = 560;
const WIDTH_KEY = "bg-lab/panelWidth";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function LabShell() {
  const [width, setWidth] = useState(344);
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  // restore persisted width after mount (avoids SSR mismatch — page is ssr:false anyway)
  useEffect(() => {
    const raw = window.localStorage.getItem(WIDTH_KEY);
    if (raw) setWidth(clamp(Number(raw) || 344, MIN_W, MAX_W));
  }, []);
  useEffect(() => {
    window.localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startW: width };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setWidth(clamp(d.startW + (e.clientX - d.startX), MIN_W, MAX_W));
  };
  const onUp = () => {
    drag.current = null;
  };

  return (
    <div className="lab-chrome font-lab flex h-[100dvh] overflow-hidden bg-canvas text-text-primary antialiased">
      <Sidebar width={width} />
      {/* drag-to-resize handle (also the panel's right divider) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="group relative z-10 w-1 shrink-0 cursor-col-resize touch-none"
      >
        <div className="absolute inset-y-0 left-0 w-px bg-border-default transition-colors group-hover:bg-border-strong group-active:bg-text-secondary" />
      </div>
      <main className="flex min-w-0 flex-1 flex-col">
        <CanvasHeader />
        <Stage />
      </main>
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
