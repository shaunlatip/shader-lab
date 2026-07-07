import { useEffect, useRef, useState } from "react";
import { galleryUrl } from "@/lib/bg-lab/presets";
import type { PatternState, SourceState } from "@/lib/bg-lab/types";
import type { EngineSource } from "@/lib/bg-lab/engine";

// Leuchtturm-notebook dot grid: small pale-gray dots on off-white paper —
// the physical ideal for a dot grid, and a light default (dark patterns were
// the odd one out; most real-world uses are paper-light). Stored patterns in
// existing configs carry their own values and are unaffected.
export const DEFAULT_PATTERN: PatternState = {
  type: "dotGrid",
  cell: 28,
  weight: 0.12,
  jitter: 0,
  angle: 0,
  stagger: false,
  fg: "#b9b6b0",
  bg: "#f5f4f1",
};

// Resolve an imageId to a URL: gallery ids map to /explorations/..., everything
// else (uploads' object URLs, pexels:<url>, pexels:video:<url>) is a direct URL.
function resolveUrl(source: SourceState): string | null {
  if ((source.mode !== "image" && source.mode !== "video") || !source.imageId) return null;
  const g = galleryUrl(source.imageId);
  if (g) return g;
  if (source.imageId.startsWith("pexels:video:")) return source.imageId.slice("pexels:video:".length);
  if (source.imageId.startsWith("pexels:")) return source.imageId.slice("pexels:".length);
  return source.imageId; // blob: / data: / http(s):
}

const imgCache = new Map<string, HTMLImageElement>();
const vidCache = new Map<string, HTMLVideoElement>();
const IMG_CAP = 40;
const VID_CAP = 6; // decoded videos are heavy — keep only a few warm

// Evict the oldest entries (Map preserves insertion order) past a cap. Videos
// get torn down so their decode pipeline is released.
function capCache<T>(cache: Map<string, T>, cap: number, tear?: (v: T) => void) {
  while (cache.size > cap) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const v = cache.get(oldest)!;
    cache.delete(oldest);
    tear?.(v);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = imgCache.get(url);
  if (hit && hit.complete) return Promise.resolve(hit);
  return new Promise((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous"; // keep canvas exportable for cross-origin (pexels)
    im.onload = () => {
      imgCache.set(url, im);
      capCache(imgCache, IMG_CAP);
      res(im);
    };
    im.onerror = () => rej(new Error("image load failed"));
    im.src = url;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  const hit = vidCache.get(url);
  if (hit && hit.readyState >= 2) return Promise.resolve(hit);
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous"; // keep canvas exportable for cross-origin (pexels)
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadeddata = () => {
      vidCache.set(url, v);
      capCache(vidCache, VID_CAP, (old) => {
        if (old !== v) {
          old.pause();
          old.removeAttribute("src");
          old.load();
        }
      });
      res(v);
    };
    v.onerror = () => rej(new Error("video load failed"));
    v.src = url;
  });
}

export interface ResolvedSource {
  engineSource: EngineSource;
  loading: boolean;
  error: string | null;
}

export function useImageSource(source: SourceState): ResolvedSource {
  const [state, setState] = useState<ResolvedSource>({ engineSource: null, loading: false, error: null });
  const reqRef = useRef(0);

  useEffect(() => {
    // Bump first so any in-flight image/video load is invalidated even when we
    // take an early (solid / no-url / pattern) return below.
    const req = ++reqRef.current;
    if (source.mode === "pattern") {
      setState({
        engineSource: { kind: "pattern", pattern: source.pattern ?? DEFAULT_PATTERN },
        loading: false,
        error: null,
      });
      return;
    }
    if (source.mode === "solid") {
      setState({ engineSource: { kind: "solid", color: source.solidColor }, loading: false, error: null });
      return;
    }
    const url = resolveUrl(source);
    if (!url) {
      setState({ engineSource: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));

    if (source.mode === "video") {
      loadVideo(url)
        .then((v) => {
          if (reqRef.current !== req) return;
          setState({ engineSource: { kind: "video", video: v }, loading: false, error: null });
        })
        .catch(() => {
          if (reqRef.current !== req) return;
          setState({ engineSource: null, loading: false, error: "Couldn't load that video." });
        });
      return;
    }

    loadImage(url)
      .then((im) => {
        if (reqRef.current !== req) return;
        setState({ engineSource: { kind: "image", image: im }, loading: false, error: null });
      })
      .catch(() => {
        if (reqRef.current !== req) return;
        setState({ engineSource: null, loading: false, error: "Couldn't load that image." });
      });
  }, [source.mode, source.imageId, source.solidColor, source.pattern]);

  return state;
}
