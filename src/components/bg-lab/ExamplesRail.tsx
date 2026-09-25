"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { EXAMPLES, presetBySlug, exampleSourceId, type Example } from "@/lib/bg-lab/presets";
import { useBgLab } from "./BgLabProvider";
import { useLibrary } from "./LibraryProvider";
import { useOnboarding } from "./OnboardingProvider";
import { IconTip } from "./panel";

const thumb = (slug: string) => `/examples/${slug}.webp`;

/** Edge fade on the scrolling strip, per side that has more to show. */
function fadeMask(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const l = left ? "transparent, black 40px" : "black";
  const r = right ? "black calc(100% - 40px), transparent" : "black";
  return `linear-gradient(to right, ${l}, ${r})`;
}

function ExampleCard({ example, active, onApply }: { example: Example; active: boolean; onApply: () => void }) {
  const presetName = presetBySlug(example.preset)?.name ?? example.preset;
  return (
    <button
      type="button"
      onClick={onApply}
      aria-pressed={active}
      title={`${example.subject} · ${presetName} — video by ${example.credit} on Pexels`}
      className="group flex w-[96px] shrink-0 flex-col gap-1 text-center @md/rail:w-[120px]"
    >
      <span
        className={cn(
          // Resting 1px edge like the preset cards (paper-toned examples would
          // otherwise melt into a light rail); active adds a ring for 2px ink.
          "overflow-hidden rounded-card border transition-[border-color,transform] duration-150 ease-out motion-safe:group-active:scale-[0.97]",
          active
            ? "border-text-primary ring-1 ring-text-primary"
            : "border-border-default group-hover:border-border-strong",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumb(example.slug)}
          alt=""
          loading="lazy"
          className="aspect-video w-full bg-surface-active object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.04]"
        />
      </span>
      <span className="flex flex-col items-center px-0.5 leading-tight">
        <span className="max-w-full truncate text-[11px] text-text-primary">{example.subject}</span>
        <span className="max-w-full truncate text-[11px] text-text-secondary transition-colors group-hover:text-text-primary">
          {presetName}
        </span>
      </span>
    </button>
  );
}

/**
 * The examples rail: a filmstrip docked under the canvas. Each example pairs a free
 * video with a preset, so one click shows a finished piece in motion — the
 * first-visit answer to "what does this do?". Applying an example swaps the
 * source and the stack together (output settings are kept).
 */
export function ExamplesRail() {
  const { config, dispatch } = useBgLab();
  const { applyStack } = useLibrary();
  const { setExamplesOpen } = useOnboarding();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const [moreLeft, setMoreLeft] = useState(false);
  const [moreRight, setMoreRight] = useState(false);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setMoreLeft(el.scrollLeft > 1);
    setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const strip = stripRef.current;
    if (!el || !strip) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(strip);
    return () => ro.disconnect();
  }, [measure]);

  function apply(example: Example) {
    const preset = presetBySlug(example.preset);
    dispatch({ t: "setSource", patch: { mode: "video", imageId: exampleSourceId(example), transform: undefined } });
    if (preset) applyStack(preset.build());
  }

  return (
    <section
      data-tour="examples"
      aria-label="Examples"
      className="@container/rail relative shrink-0 border-t border-border-default bg-canvas px-3 pb-3 pt-2.5"
    >
      {/* Centered title; the close button is pinned to the corner so it
          doesn't pull the title off-center. */}
      <h2 className="mb-2 px-8 text-center text-[13px] font-medium leading-6 text-text-primary">Start from an example</h2>
      <IconTip label="Hide examples">
        <button
          type="button"
          onClick={() => setExamplesOpen(false)}
          aria-label="Hide examples"
          className="absolute right-3 top-2.5 grid h-6 w-6 place-items-center rounded-control text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </IconTip>
      {/* Centered when it fits (mx-auto on a w-max strip — unlike
          justify-center, it never clips the start when it overflows); scrolls
          sideways when the stage is narrower, with an edge fade on whichever
          side has more. */}
      <div
        ref={scrollRef}
        onScroll={measure}
        // Mouse wheels only scroll vertically; the strip has nothing to
        // scroll that way, so map it sideways.
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none]"
        style={{ maskImage: fadeMask(moreLeft, moreRight), WebkitMaskImage: fadeMask(moreLeft, moreRight) }}
      >
        <div ref={stripRef} className="mx-auto flex w-max gap-2">
          {EXAMPLES.map((r) => (
            <ExampleCard
              key={r.slug}
              example={r}
              active={config.source.mode === "video" && config.source.imageId === exampleSourceId(r)}
              onApply={() => apply(r)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
