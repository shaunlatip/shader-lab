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
      className="group relative z-10 w-1 shrink-0 cursor-col-resize touch-none outline-none"
    >
      {/* Invisible at rest — the Stage's background swings from near-white to
          near-black across themes, so any fixed resting color reads as a
          stray bright/dark bar on one side. Only reveal on hover/focus/drag,
          when a line is expected and its exact tone doesn't matter. */}
      <div
        className={
          "absolute inset-y-0 w-px bg-transparent transition-colors group-hover:bg-border-strong/70 group-active:bg-border-strong group-focus-visible:bg-border-strong " +
          (side === "left" ? "left-0" : "right-0")
        }
      />
    </div>
  );
}
