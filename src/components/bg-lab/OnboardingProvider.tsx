import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Onboarding state: the examples rail under the canvas and the first-visit tour.
// Both persist per browser — close the rail once and it stays closed (the
// canvas toolbar reopens it); finish or skip the tour once and it never
// auto-starts again (the header's tour button replays it).
const EXAMPLES_KEY = "shader-lab/examples-open";
const TOUR_KEY = "shader-lab/tour-done";

function readFlag(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeFlag(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

interface OnboardingCtx {
  examplesOpen: boolean;
  setExamplesOpen: (open: boolean) => void;
  /** Index into the tour's steps, or null when the tour isn't showing. */
  tourStep: number | null;
  setTourStep: (step: number | null) => void;
  startTour: () => void;
  /** Close the tour and remember it (finish or skip). */
  endTour: () => void;
}

const OnboardingContext = createContext<OnboardingCtx | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [examplesOpen, setExamplesOpenState] = useState(() => readFlag(EXAMPLES_KEY) !== "0");
  const [tourStep, setTourStep] = useState<number | null>(null);

  const setExamplesOpen = useCallback((open: boolean) => {
    setExamplesOpenState(open);
    writeFlag(EXAMPLES_KEY, open ? "1" : "0");
  }, []);

  const startTour = useCallback(() => {
    // The first step points at the rail — make sure it's there to point at.
    setExamplesOpen(true);
    setTourStep(0);
  }, [setExamplesOpen]);

  const endTour = useCallback(() => {
    setTourStep(null);
    writeFlag(TOUR_KEY, "1");
  }, []);

  // First visit: start the tour once the canvas has had a moment to show the
  // lead example — the tour explains what's already moving on screen.
  useEffect(() => {
    if (readFlag(TOUR_KEY)) return;
    const id = window.setTimeout(() => setTourStep(0), 1200);
    return () => window.clearTimeout(id);
  }, []);

  const value = useMemo(
    () => ({ examplesOpen, setExamplesOpen, tourStep, setTourStep, startTour, endTour }),
    [examplesOpen, setExamplesOpen, tourStep, startTour, endTour],
  );
  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingCtx {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
