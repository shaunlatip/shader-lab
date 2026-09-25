"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { labButton } from "./panel";
import { useOnboarding } from "./OnboardingProvider";

type Side = "top" | "bottom" | "left" | "right";

interface Step {
  /** data-tour value of the element to point at */
  target: string;
  side: Side;
  title: string;
  body: string;
}

// Four stops, in the order a first-time visitor needs them: what's playing,
// how to change it, how to bring your own, how to take it out.
const STEPS: Step[] = [
  {
    target: "examples",
    side: "top",
    title: "Start from an example",
    body: "Each example pairs a free video with a preset. Click through them to see the range.",
  },
  {
    target: "effects",
    side: "left",
    title: "Tweak the effects",
    body: "A preset is a stack of effects, applied top to bottom. Open one to adjust it, or try another preset below the stack.",
  },
  {
    target: "source",
    side: "right",
    title: "Use your own media",
    body: "Upload an image or video, search Pexels, or drop a file anywhere on the canvas.",
  },
  {
    target: "export",
    side: "right",
    title: "Export",
    body: "Save a still, GIF, or MP4 at full resolution.",
  },
];

const CARD_W = 280;
const GAP = 12;
const EDGE = 12;

type Rect = { top: number; left: number; width: number; height: number };

function findTarget(step: Step): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

function placeCard(r: Rect, side: Side, cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  let left: number;
  if (side === "top" || side === "bottom") {
    left = r.left + r.width / 2 - CARD_W / 2;
    top = side === "top" ? r.top - GAP - cardH : r.top + r.height + GAP;
  } else {
    top = r.top + Math.min(r.height, 120) / 2 - cardH / 2;
    left = side === "left" ? r.left - GAP - CARD_W : r.left + r.width + GAP;
  }
  return {
    top: Math.min(Math.max(EDGE, top), vh - cardH - EDGE),
    left: Math.min(Math.max(EDGE, left), vw - CARD_W - EDGE),
  };
}

/**
 * First-visit walkthrough: a highlight ring on one part of the UI plus a short
 * card, four stops. Non-modal — the page stays usable underneath, so a visitor
 * can click an example mid-tour. Steps whose target isn't on screen (a collapsed
 * panel) are skipped. Esc skips the tour, Enter / → advance.
 */
export function Tour() {
  const { tourStep, setTourStep, endTour } = useOnboarding();
  const [rect, setRect] = useState<Rect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const [cardH, setCardH] = useState(120);

  // Steps available right now (a collapsed panel removes its anchors) —
  // measured in the rAF tick below alongside the target rect.
  const [available, setAvailable] = useState<number[]>([]);

  // If the requested step has no target, move to the next one that does.
  useEffect(() => {
    if (tourStep === null) return;
    if (findTarget(STEPS[tourStep])) return;
    const next = STEPS.findIndex((s, i) => i > tourStep && findTarget(s));
    if (next >= 0) setTourStep(next);
    else endTour();
  }, [tourStep, setTourStep, endTour]);

  // Track the target's rect every frame while open — panels resize, the rail
  // opens, the right panel scrolls. setState only on change.
  useEffect(() => {
    if (tourStep === null) return;
    let raf = 0;
    let last = "";
    let lastAvail = "";
    const tick = () => {
      const avail = STEPS.map((s, i) => (findTarget(s) ? i : -1)).filter((i) => i >= 0);
      const availKey = avail.join(",");
      if (availKey !== lastAvail) {
        lastAvail = availKey;
        setAvailable(avail);
      }
      const el = findTarget(STEPS[tourStep]);
      if (el) {
        const r = el.getBoundingClientRect();
        const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
        if (key !== last) {
          last = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [tourStep]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [tourStep, rect]);

  // Keyboard: focus the primary action on each step so Enter advances and a
  // screen reader lands inside the card.
  // Keyed on `shown` too: the card mounts a frame after the step is set (once
  // the target's rect is measured), so focusing on the step change alone
  // would find no button.
  const shown = tourStep !== null && rect !== null;
  useEffect(() => {
    if (shown) nextRef.current?.focus({ preventScroll: true });
  }, [tourStep, shown]);

  if (tourStep === null || !rect) return null;
  const step = STEPS[tourStep];
  const pos = available.indexOf(tourStep);
  const isLast = pos === available.length - 1;
  const next = () => {
    const n = available[pos + 1];
    if (n === undefined) endTour();
    else setTourStep(n);
  };
  const back = () => {
    const p = available[pos - 1];
    if (p !== undefined) setTourStep(p);
  };
  const card = placeCard(rect, step.side, cardH);
  const PAD = 4;

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {/* Highlight: a ring around the target, everything else dimmed — one
          box-shadow for both (Tailwind's ring-* is also a box-shadow, so a
          separate inline shadow would override it). */}
      <div
        aria-hidden
        className="absolute rounded-card transition-[top,left,width,height] duration-200 ease-out motion-reduce:transition-none"
        style={{
          top: rect.top - PAD,
          left: rect.left - PAD,
          width: rect.width + PAD * 2,
          height: rect.height + PAD * 2,
          boxShadow: "0 0 0 2px var(--color-text-primary), 0 0 0 9999px rgb(0 0 0 / 0.45)",
        }}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        onKeyDown={(e) => {
          if (e.key === "Escape") endTour();
          else if (e.key === "ArrowRight") next();
          else if (e.key === "ArrowLeft") back();
        }}
        className="lab-chrome font-lab pointer-events-auto absolute flex flex-col gap-2 rounded-card border border-border-default bg-canvas-elevated p-3 text-text-primary shadow-5 transition-[top,left] duration-200 ease-out motion-reduce:transition-none"
        style={{ top: card.top, left: card.left, width: CARD_W }}
      >
        <h2 id="tour-title" className="text-[13px] font-medium leading-tight">
          {step.title}
        </h2>
        <p id="tour-body" className="text-[12px] leading-snug text-text-secondary">
          {step.body}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] tabular-nums text-text-secondary">
            {pos + 1} of {available.length}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={endTour}
              className="h-7 rounded-control px-2 text-[12px] text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              Skip
            </button>
            {pos > 0 && (
              <button type="button" onClick={back} className={cn(labButton, "h-7 rounded-control px-2.5 text-[12px]")}>
                Back
              </button>
            )}
            <button
              ref={nextRef}
              type="button"
              onClick={next}
              className="h-7 rounded-control bg-text-primary px-2.5 text-[12px] text-canvas transition-[transform,background-color] duration-150 hover:bg-text-primary/90 active:scale-[0.98]"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
