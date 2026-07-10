"use client";

import { useRef } from "react";
import type { PanelSide } from "@/hooks/usePanelState";

const KEY_STEP = 16;

/**
 * Drag handle between a side panel and the stage. For the right panel the
 * pointer delta inverts (dragging left grows the panel). Keyboard: arrows
 * resize by 16px, Enter/Space toggles collapse. Double-click also collapses.
 */
export function PanelResizer({
  side,
  width,
  min,
  max,
  collapsed,
  onWidth,
  onToggle,
}: {
  side: PanelSide;
  width: number;
  min: number;
  max: number;
  collapsed: boolean;
  onWidth: (w: number) => void;
  onToggle: () => void;
}) {
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  const sign = side === "left" ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent) => {
    if (collapsed) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startW: width };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    onWidth(d.startW + sign * (e.clientX - d.startX));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onWidth(width + (side === "left" ? -KEY_STEP : KEY_STEP));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onWidth(width + (side === "left" ? KEY_STEP : -KEY_STEP));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    // Zero-width layout anchor — no reserved flex space between the aside and
    // the stage. Previously this element WAS w-1 (a real 4px-wide flex item),
    // so the aside's own border sat 4px before the stage's differently-colored
    // surface actually began; that 4px strip rendered in the aside's own
    // background (nothing painted it as "stage"), which read as the border
    // floating a few px away from the real panel edge on both sides. Now the
    // aside and stage sit flush — only the 1px border is between them — and
    // the interactive hit target below is absolutely positioned so it adds a
    // comfortable grab area without taking any layout width at all.
    <div className="relative z-10 w-0 shrink-0">
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label={`Resize ${side} panel`}
        aria-valuenow={collapsed ? min : width}
        aria-valuemin={min}
        aria-valuemax={max}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onToggle}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -inset-x-1 cursor-col-resize touch-none outline-none"
      >
        {/* The persistent seam is the panel's own border (border-r/border-l on
            the aside) — this sits exactly on top of that 1px border (the
            zero-width anchor above IS the border's position) and only
            strengthens the tone on hover/focus/drag, so the divider reads as
            "grabbable" without adding a second line or any reserved gap.
            Geometry is now symmetric, so no side-dependent offset is needed. */}
        <div className="pointer-events-none absolute inset-y-0 right-1 w-px bg-transparent transition-colors group-hover:bg-border-strong/70 group-active:bg-border-strong group-focus-visible:bg-border-strong" />
      </div>
    </div>
  );
}
