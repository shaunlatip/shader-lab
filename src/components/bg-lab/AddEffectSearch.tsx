import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORY_LABEL, CATEGORY_ORDER, EFFECT_CATALOG, EFFECT_ORDER } from "@/lib/bg-lab/catalog";
import type { EffectType } from "@/lib/bg-lab/types";
import { useBgLab } from "./BgLabProvider";

/**
 * Figma-style "add" affordance: a search field that opens a dropdown on focus,
 * filters the catalog as you type, and appends the chosen effect to the stack.
 * Rendered inline (not portaled) so it inherits the lab's dark tokens + Work
 * Sans; the dropdown overlays the effect list below with z-50.
 */
export function AddEffectSearch() {
  const { dispatch } = useBgLab();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EFFECT_ORDER.filter((t) => {
      if (!q) return true;
      const m = EFFECT_CATALOG[t];
      return (m.label + " " + m.blurb).toLowerCase().includes(q);
    });
  }, [query]);

  // keep active index in range as the filter narrows
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  // dismiss on outside click
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function choose(t: EffectType) {
    dispatch({ t: "addType", type: t });
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = matches[active];
      if (t) choose(t);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          "flex h-9 items-center gap-2 rounded-control border bg-canvas px-2.5 transition-colors",
          open ? "border-text-secondary" : "border-border-default hover:border-border-strong",
        )}
      >
        <Search className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Add an effect…"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-secondary focus:outline-none"
        />
        <Plus className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
      </div>

      {open && (
        <div
          ref={listRef}
          // Origin-aware enter (Emil): scales + fades in from the top edge near
          // the field, ease-out, well under 300ms.
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[320px] origin-top animate-in overflow-y-auto rounded-card border border-border-default bg-canvas p-1 shadow-5 duration-150 ease-out fade-in-0 zoom-in-95"
        >
          {matches.length === 0 ? (
            <p className="px-2.5 py-2 text-[12px] text-text-secondary">No effect matches “{query}”.</p>
          ) : (
            CATEGORY_ORDER.map((cat) => {
              const items = matches.filter((t) => EFFECT_CATALOG[t].category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-text-secondary">
                    {CATEGORY_LABEL[cat]}
                  </p>
                  {items.map((t) => {
                    const m = EFFECT_CATALOG[t];
                    const i = matches.indexOf(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        // mousedown (not click) so selection fires before the input's
                        // blur/outside-click handler can close the menu first.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          choose(t);
                        }}
                        onMouseEnter={() => setActive(i)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 rounded-[5px] px-2.5 py-1.5 text-left transition-colors duration-100",
                          i === active ? "bg-canvas-inverted/10" : "hover:bg-canvas-inverted/[0.06]",
                        )}
                      >
                        <div className="flex w-full items-baseline justify-between gap-2">
                          <span className="text-[13px] font-medium text-text-primary">{m.label}</span>
                          {m.heavy && (
                            <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-secondary">
                              heavy
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] leading-snug text-text-secondary">{m.blurb}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
