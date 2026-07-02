// Saved effect-sets + drafts — the user's persisted library (localStorage).

import { nanoid } from "nanoid";
import type { BgConfig, Effect, SourceState } from "./types";
import { EFFECT_CATALOG } from "./catalog";
import { GALLERY, PRESETS } from "./presets";

/** A named, reusable effect stack. `builtin` ones ship with the app. */
export interface SavedEffect {
  id: string;
  name: string;
  stack: Effect[];
  builtin?: boolean;
}

/** A named snapshot of the whole editor (source + output + stack). */
export interface Draft {
  id: string;
  name: string;
  config: BgConfig;
}

export const SAVED_KEY = "bg-lab/saved/v1";
export const DRAFTS_KEY = "bg-lab/drafts/v1";

/** Built-in preset looks, materialized as saved effects. */
export function builtinSaved(): SavedEffect[] {
  return PRESETS.map((p, i) => ({ id: `builtin-${i}`, name: p.name, stack: p.build(), builtin: true }));
}

/** Fresh ids + cloned params so a loaded stack is independent of the stored one. */
export function reIdStack(stack: Effect[]): Effect[] {
  return stack.map((e) => ({ ...e, id: nanoid(8), params: { ...e.params } }));
}

function readArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function loadSaved(): SavedEffect[] {
  return readArray<SavedEffect>(SAVED_KEY).filter((s) => s && Array.isArray(s.stack));
}

export function loadDrafts(): Draft[] {
  return readArray<Draft>(DRAFTS_KEY).filter((d) => d && d.config && Array.isArray(d.config.stack));
}

const PATTERN_TYPE_LABEL: Record<string, string> = {
  dotGrid: "Dot grid",
  lineGrid: "Line grid",
  checker: "Checker",
  stripes: "Stripes",
  rings: "Rings",
  iso: "Iso lattice",
};

/** Human label for a source, for auto-naming. */
function sourceLabel(s: SourceState): string {
  if (s.mode === "pattern") return "Pattern · " + (PATTERN_TYPE_LABEL[s.pattern?.type ?? ""] ?? "");
  if (s.mode === "solid") return s.solidColor;
  const id = s.imageId;
  if (!id) return s.mode === "video" ? "Video" : "";
  const g = GALLERY.find((x) => x.id === id);
  if (g) return g.label;
  if (id.startsWith("pexels:video:")) return "Pexels clip";
  if (id.startsWith("pexels:")) return "Pexels";
  if (id.startsWith("blob:") || id.startsWith("data:")) return s.mode === "video" ? "Upload clip" : "Upload";
  return s.mode === "video" ? "Video" : "Image";
}

/** Generate a readable draft name from the look: top effects + source. */
export function suggestDraftName(config: BgConfig): string {
  const fx = config.stack
    .filter((e) => e.enabled && e.type)
    .map((e) => EFFECT_CATALOG[e.type!].label)
    .slice(0, 2)
    .join(" + ");
  const src = sourceLabel(config.source);
  if (fx && src) return `${fx} · ${src}`;
  return fx || src || "Untitled";
}
