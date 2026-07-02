import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { arrayMove } from "@dnd-kit/sortable";
import { nanoid } from "nanoid";
import { defaultParams } from "@/lib/bg-lab/catalog";
import { makeDefaultConfig } from "@/lib/bg-lab/presets";
import type {
  BgConfig,
  Effect,
  EffectType,
  OutputState,
  ParamValue,
  SourceState,
} from "@/lib/bg-lab/types";

const STORAGE_KEY = "bg-lab/config/v1";

export type BgAction =
  | { t: "toggle"; id: string }
  | { t: "setParam"; id: string; key: string; value: ParamValue }
  | { t: "reorder"; from: number; to: number }
  | { t: "add" }
  | { t: "addType"; type: EffectType }
  | { t: "setType"; id: string; type: EffectType }
  | { t: "setStack"; stack: Effect[] }
  | { t: "remove"; id: string }
  | { t: "setSource"; patch: Partial<SourceState> }
  | { t: "setOutput"; patch: Partial<OutputState> }
  | { t: "replace"; config: BgConfig }
  | { t: "reset" };

function reducer(state: BgConfig, a: BgAction): BgConfig {
  switch (a.t) {
    case "toggle":
      return { ...state, stack: state.stack.map((e) => (e.id === a.id ? { ...e, enabled: !e.enabled } : e)) };
    case "setParam":
      return {
        ...state,
        stack: state.stack.map((e) =>
          e.id === a.id ? { ...e, params: { ...e.params, [a.key]: a.value } } : e,
        ),
      };
    case "reorder":
      return { ...state, stack: arrayMove(state.stack, a.from, a.to) };
    case "add":
      return { ...state, stack: [...state.stack, { id: nanoid(8), type: null, enabled: true, params: {} }] };
    case "addType":
      return {
        ...state,
        stack: [
          ...state.stack,
          { id: nanoid(8), type: a.type, enabled: true, params: defaultParams(a.type) },
        ],
      };
    case "setType":
      return {
        ...state,
        stack: state.stack.map((e) =>
          e.id === a.id ? { ...e, type: a.type, params: defaultParams(a.type) } : e,
        ),
      };
    case "setStack":
      return { ...state, stack: a.stack };
    case "remove":
      return { ...state, stack: state.stack.filter((e) => e.id !== a.id) };
    case "setSource":
      return { ...state, source: { ...state.source, ...a.patch } };
    case "setOutput":
      return { ...state, output: { ...state.output, ...a.patch } };
    case "replace":
      return a.config;
    case "reset":
      return makeDefaultConfig();
    default:
      return state;
  }
}

function init(): BgConfig {
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === 1 && Array.isArray(parsed.stack)) return parsed as BgConfig;
      }
    } catch {
      /* ignore */
    }
  }
  return makeDefaultConfig();
}

interface Ctx {
  config: BgConfig;
  dispatch: Dispatch<BgAction>;
}
const BgLabContext = createContext<Ctx | null>(null);

export function BgLabProvider({ children }: { children: ReactNode }) {
  const [config, dispatch] = useReducer(reducer, undefined, init);

  // debounced persist
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      } catch {
        /* ignore quota */
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [config]);

  const value = useMemo(() => ({ config, dispatch }), [config]);
  return <BgLabContext.Provider value={value}>{children}</BgLabContext.Provider>;
}

export function useBgLab(): Ctx {
  const ctx = useContext(BgLabContext);
  if (!ctx) throw new Error("useBgLab must be used within BgLabProvider");
  return ctx;
}

export type { Effect };
