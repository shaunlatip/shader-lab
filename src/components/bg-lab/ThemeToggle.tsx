"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { IconTip } from "./panel";

// Canonical hydration-safe mounted check (no setState-in-effect):
// server snapshot false, client snapshot true, never re-subscribes.
const emptySubscribe = () => () => {};
const useMounted = () => useSyncExternalStore(emptySubscribe, () => true, () => false);

/**
 * Manual theme toggle. The lab auto-themes by time of day (head script in
 * layout.tsx); an explicit click here sets the "theme-manual" flag so the
 * auto-theme stops overriding on future loads. The circle icon carries its
 * own view-transition-name so it snaps while the page cross-fades.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  const isDark = resolvedTheme === "dark";

  const toggle = () => {
    const next = isDark ? "light" : "dark";
    try {
      localStorage.setItem("theme-manual", "1");
    } catch {}
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => void;
    };
    if (doc.startViewTransition) {
      doc.startViewTransition(() => setTheme(next));
    } else {
      setTheme(next);
    }
  };

  const label = mounted ? `Switch to ${isDark ? "light" : "dark"} theme` : "Switch theme";

  return (
    <IconTip label={label} side="bottom">
      <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={label}>
        <span
          aria-hidden
          className="theme-toggle-circle-topbar block h-3.5 w-3.5 rounded-full border-[1.5px] border-current"
          style={{
            // Half-filled disc: reads as "the other side" of the theme.
            background: mounted
              ? `linear-gradient(90deg, currentColor 50%, transparent 50%)`
              : undefined,
          }}
        />
      </Button>
    </IconTip>
  );
}
