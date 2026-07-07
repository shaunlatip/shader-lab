"use client";

import { useCallback, useEffect, useState } from "react";

export type PanelSide = "left" | "right";

type PanelBounds = { min: number; max: number; fallback: number };

export const PANEL_BOUNDS: Record<PanelSide, PanelBounds> = {
  left: { min: 280, max: 480, fallback: 328 },
  right: { min: 300, max: 560, fallback: 360 },
};

const LEGACY_WIDTH_KEY = "bg-lab/panelWidth";
const key = (side: PanelSide) => `bg-lab/panel/${side}`;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function readInitial(side: PanelSide): { w: number; c: boolean } {
  const { min, max, fallback } = PANEL_BOUNDS[side];
  if (typeof window === "undefined") return { w: fallback, c: false };
  try {
    const raw = window.localStorage.getItem(key(side));
    if (raw) {
      const parsed = JSON.parse(raw) as { w?: number; c?: boolean };
      return {
        w: clamp(Number(parsed.w) || fallback, min, max),
        c: Boolean(parsed.c),
      };
    }
    // One-time migration from the single-sidebar era: the old key carried the
    // left panel's width. Consume it, then drop it.
    if (side === "left") {
      const legacy = window.localStorage.getItem(LEGACY_WIDTH_KEY);
      if (legacy) {
        window.localStorage.removeItem(LEGACY_WIDTH_KEY);
        return { w: clamp(Number(legacy) || fallback, min, max), c: false };
      }
    }
  } catch {
    // ignore storage failures; fall through to defaults
  }
  return { w: fallback, c: false };
}

/**
 * Width + collapsed state for one side panel, persisted per side at
 * bg-lab/panel/<side> as {w, c}. Width memory survives collapse. The page
 * renders with ssr:false, so lazy-initializing from localStorage is safe
 * (no hydration mismatch) and avoids a post-mount setState flash.
 */
export function usePanelState(side: PanelSide) {
  const { min, max } = PANEL_BOUNDS[side];
  const [state, setState] = useState(() => readInitial(side));

  useEffect(() => {
    try {
      window.localStorage.setItem(key(side), JSON.stringify(state));
    } catch {
      // storage may be unavailable (private mode); state stays in-memory
    }
  }, [side, state]);

  const setWidth = useCallback(
    (w: number) => setState((s) => ({ ...s, w: clamp(w, min, max) })),
    [min, max],
  );
  const toggleCollapsed = useCallback(
    () => setState((s) => ({ ...s, c: !s.c })),
    [],
  );

  return {
    width: state.w,
    collapsed: state.c,
    setWidth,
    toggleCollapsed,
    min,
    max,
  };
}
