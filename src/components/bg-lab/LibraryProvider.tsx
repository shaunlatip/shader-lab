import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import {
  DRAFTS_KEY,
  SAVED_KEY,
  builtinSaved,
  loadDrafts,
  loadSaved,
  reIdStack,
  suggestDraftName,
  type Draft,
  type SavedEffect,
} from "@/lib/bg-lab/library";
import type { Effect, SourceState } from "@/lib/bg-lab/types";
import { useBgLab } from "./BgLabProvider";

interface LibCtx {
  builtins: SavedEffect[];
  saved: SavedEffect[];
  drafts: Draft[];
  draftName: string;
  setDraftName: (n: string) => void;
  /** Save the live stack as a named effect-set. */
  saveStack: (name: string) => void;
  /** Save an arbitrary stack as a named effect-set (used by the AI flow). */
  saveStackFrom: (name: string, stack: Effect[]) => void;
  /** Load a saved/built-in stack into the editor. Generative-source builtins
   * pass a `source` patch that replaces the editor source too. */
  applyStack: (stack: Effect[], source?: Partial<SourceState>) => void;
  removeSaved: (id: string) => void;
  /** The draft the editor is currently bound to (updates write to it). */
  activeDraftId: string | null;
  /** True when the editor differs from the active draft's saved state (or no
   * draft is active yet) — i.e. there is something to save. */
  dirty: boolean;
  /** Save the editor state: updates the active draft in place, else creates one. */
  saveDraft: (name: string) => void;
  /** Always fork a new draft (and make it active). */
  saveAsNewDraft: (name: string) => void;
  loadDraft: (id: string) => void;
  removeDraft: (id: string) => void;
  /** Revert the editor to the active draft's saved state (or default if none). */
  revertDraft: () => void;
}

const LibraryContext = createContext<LibCtx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { config, dispatch } = useBgLab();
  const [builtins] = useState<SavedEffect[]>(() => builtinSaved());
  const [saved, setSaved] = useState<SavedEffect[]>(() => loadSaved());
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts());
  const [draftName, setDraftName] = useState("Untitled");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  // Synchronous mirror of activeDraftId so a fast double-save resolves identity
  // before React commits the state update (prevents duplicate drafts).
  const activeRef = useRef<string | null>(null);
  const setActive = (id: string | null) => {
    activeRef.current = id;
    setActiveDraftId(id);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
    } catch {
      /* ignore quota */
    }
  }, [saved]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
    } catch {
      /* ignore quota */
    }
  }, [drafts]);

  // Cheap deep-compare: configs are small serializable objects with a stable
  // key order (both sides originate from the same reducers/clones), so
  // stringify equality is reliable here. Effect ids are stripped — loadDraft
  // re-ids the stack, and identity shouldn't read as an unsaved change.
  const active = activeDraftId ? drafts.find((d) => d.id === activeDraftId) : null;
  const normalize = (c: typeof config) =>
    JSON.stringify({ ...c, stack: c.stack.map(({ id: _id, ...rest }) => rest) });
  const dirty = !active || normalize(active.config) !== normalize(config);

  const value = useMemo<LibCtx>(
    () => ({
      builtins,
      saved,
      drafts,
      draftName,
      setDraftName,
      dirty,
      saveStack: (name) =>
        setSaved((s) => [{ id: nanoid(8), name: name.trim() || "Untitled set", stack: reIdStack(config.stack) }, ...s]),
      saveStackFrom: (name, stack) =>
        setSaved((s) => [{ id: nanoid(8), name: name.trim() || "AI set", stack: reIdStack(stack) }, ...s]),
      applyStack: (stack, source) => {
        if (source) dispatch({ t: "setSource", patch: source });
        dispatch({ t: "setStack", stack: reIdStack(stack) });
      },
      removeSaved: (id) => setSaved((s) => s.filter((x) => x.id !== id)),
      activeDraftId,
      saveDraft: (name) => {
        const clone = JSON.parse(JSON.stringify(config));
        const finalName = name.trim() || suggestDraftName(config);
        let aid = activeRef.current;
        if (!aid) {
          aid = nanoid(8);
          setActive(aid); // resolve identity synchronously so a 2nd quick call updates, not duplicates
        }
        setDrafts((d) =>
          d.some((x) => x.id === aid)
            ? d.map((x) => (x.id === aid ? { ...x, name: finalName, config: clone } : x))
            : [{ id: aid!, name: finalName, config: clone }, ...d],
        );
        setDraftName(finalName);
      },
      saveAsNewDraft: (name) => {
        const clone = JSON.parse(JSON.stringify(config));
        const finalName = name.trim() || suggestDraftName(config);
        const id = nanoid(8);
        setActive(id);
        setDrafts((d) => [{ id, name: finalName, config: clone }, ...d]);
        setDraftName(finalName);
      },
      loadDraft: (id) => {
        const draft = drafts.find((x) => x.id === id);
        if (!draft) return;
        dispatch({ t: "replace", config: { ...draft.config, stack: reIdStack(draft.config.stack) } });
        setDraftName(draft.name);
        setActive(id);
      },
      removeDraft: (id) => {
        if (id === activeRef.current) setActive(null);
        setDrafts((d) => d.filter((x) => x.id !== id));
      },
      revertDraft: () => {
        const aid = activeRef.current;
        const draft = aid ? drafts.find((x) => x.id === aid) : null;
        if (draft) {
          dispatch({ t: "replace", config: { ...draft.config, stack: reIdStack(draft.config.stack) } });
          setDraftName(draft.name); // keep the name in sync so the next save doesn't silently rename
        } else {
          dispatch({ t: "reset" });
          setDraftName("");
        }
      },
    }),
    [builtins, saved, drafts, draftName, activeDraftId, dirty, config, dispatch],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibCtx {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used within LibraryProvider");
  return ctx;
}
