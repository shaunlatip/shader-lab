import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Circular rotation control (Matte-style) — a knob you drag around a ring
 * instead of a linear slider, which reads much more directly as "rotation"
 * than a -180..180 bar ever does. Storage stays -180..180 (matches every
 * other angle-driven pattern/effect and the schema clamp range); the dial
 * only normalizes to 0..359 for display, since 0° = top and increases
 * clockwise is how a rotation dial reads, not how the stored value sorts.
 */
export function RotationDial({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (deg: number) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const angleFromPointer = useCallback((clientX: number, clientY: number): number | null => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    // 0deg = up (12 o'clock), clockwise positive. atan2's own range is
    // already -180..180, matching the stored value 1:1 — no wrap needed.
    return Math.round((Math.atan2(dx, -dy) * 180) / Math.PI);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const a = angleFromPointer(e.clientX, e.clientY);
    if (a !== null) onChange(a);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const a = angleFromPointer(e.clientX, e.clientY);
    if (a !== null) onChange(a);
  }
  function onPointerUp() {
    dragging.current = false;
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(value - 1);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(value + 1);
    }
  }

  const norm = ((value % 360) + 360) % 360;
  const rad = (norm * Math.PI) / 180;
  const dotX = 50 + 38 * Math.sin(rad);
  const dotY = 50 - 38 * Math.cos(rad);

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="Rotation"
        aria-valuenow={Math.round(norm)}
        aria-valuemin={0}
        aria-valuemax={359}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onKeyDown={onKeyDown}
        className="relative h-16 w-16 shrink-0 cursor-pointer touch-none rounded-full border border-border-default bg-canvas outline-none transition-colors hover:border-border-strong focus-visible:border-text-secondary"
      >
        {/* center pip + a line toward the handle, so the dial reads as a
            pointer/knob rather than a bare dot orbiting a ring */}
        <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-secondary" />
        <div
          className="absolute left-1/2 top-1/2 h-[1.5px] w-[15px] origin-left bg-text-secondary"
          style={{ transform: `rotate(${norm - 90}deg)` }}
        />
        <div
          className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text-primary shadow-1"
          style={{ left: `${dotX}%`, top: `${dotY}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-text-secondary">{Math.round(norm)}°</span>
    </div>
  );
}
