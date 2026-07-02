// BG Lab — copy-paste "AI config" schema text + validation/clamping.
// The pasted JSON IS a BgConfig, so round-trips are identity. clampParams is
// total: a malformed/hallucinated blob can never crash the render.

import { nanoid } from "nanoid";
import { EFFECT_CATALOG, EFFECT_ORDER, controlDefault, defaultParams, type ControlSpec } from "./catalog";
import { makeDefaultConfig } from "./presets";
import type { BgConfig, Effect, EffectType, GradientStop, ParamValue } from "./types";

const clampNum = (v: unknown, min: number, max: number, step: number, def: number): number => {
  let n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) n = def;
  n = Math.min(max, Math.max(min, n));
  if (step >= 1) n = Math.round(n / step) * step;
  return n;
};

function clampOne(spec: ControlSpec, v: unknown): ParamValue {
  switch (spec.kind) {
    case "slider":
      return clampNum(v, spec.min, spec.max, spec.step, spec.default);
    case "switch":
      return typeof v === "boolean" ? v : spec.default;
    case "select":
      return spec.options.some((o) => o.value === v) ? (v as string) : spec.default;
    case "color":
      return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : spec.default;
    case "text":
      return typeof v === "string" ? v.slice(0, spec.maxLen ?? 200) : spec.default;
    case "gradient": {
      if (!Array.isArray(v) || v.length < 2) return controlDefault(spec);
      const stops = v
        .filter((s) => s && typeof s === "object")
        .map((s: { t?: unknown; color?: unknown }) => ({
          t: clampNum(s.t, 0, 1, 0.001, 0),
          color: typeof s.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : "#000000",
        })) as GradientStop[];
      return stops.length >= 2 ? stops : controlDefault(spec);
    }
  }
}

/** coerce a params object to valid values for `type`; drop unknown keys, fill missing */
export function clampParams(type: EffectType, raw: unknown): Record<string, ParamValue> {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = defaultParams(type);
  for (const spec of EFFECT_CATALOG[type].controls) {
    if (spec.key in src) out[spec.key] = clampOne(spec, src[spec.key]);
  }
  return out;
}

const isEffectType = (t: unknown): t is EffectType => typeof t === "string" && t in EFFECT_CATALOG;

/** parse + validate a pasted config; throws Error with a human message on failure */
export function validateConfig(text: string): BgConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That isn't valid JSON.");
  }
  if (!raw || typeof raw !== "object") throw new Error("Expected a JSON object.");
  const o = raw as Record<string, unknown>;
  const base = makeDefaultConfig();

  // output
  const out = { ...base.output };
  if (o.output && typeof o.output === "object") {
    const oo = o.output as Record<string, unknown>;
    if (typeof oo.aspect === "string" || (oo.aspect && typeof oo.aspect === "object")) out.aspect = oo.aspect as BgConfig["output"]["aspect"];
    if (typeof oo.longEdge === "number") out.longEdge = clampNum(oo.longEdge, 200, 6000, 1, 2000);
  }

  // source
  const source = { ...base.source };
  if (o.source && typeof o.source === "object") {
    const so = o.source as Record<string, unknown>;
    if (so.mode === "solid" || so.mode === "image" || so.mode === "video") source.mode = so.mode;
    if (typeof so.imageId === "string" || so.imageId === null) source.imageId = so.imageId as string | null;
    if (typeof so.solidColor === "string" && /^#[0-9a-fA-F]{6}$/.test(so.solidColor)) source.solidColor = so.solidColor;
    if (so.transform && typeof so.transform === "object") {
      const t = so.transform as Record<string, unknown>;
      const tf: NonNullable<BgConfig["source"]["transform"]> = {};
      if (t.rotate === 0 || t.rotate === 90 || t.rotate === 180 || t.rotate === 270) tf.rotate = t.rotate;
      if (typeof t.flipH === "boolean") tf.flipH = t.flipH;
      if (t.crop && typeof t.crop === "object") {
        const c = t.crop as Record<string, unknown>;
        if (["x", "y", "w", "h"].every((k) => typeof c[k] === "number")) {
          tf.crop = { x: c.x as number, y: c.y as number, w: c.w as number, h: c.h as number };
        }
      }
      source.transform = tf;
    }
  }

  // stack
  if (!Array.isArray(o.stack)) throw new Error("Missing a `stack` array.");
  const stack: Effect[] = o.stack
    .filter((e) => e && typeof e === "object")
    .map((e: Record<string, unknown>) => {
      const type = isEffectType(e.type) ? e.type : null;
      return {
        id: typeof e.id === "string" && e.id ? e.id : nanoid(8),
        type,
        enabled: typeof e.enabled === "boolean" ? e.enabled : true,
        params: type ? clampParams(type, e.params) : {},
      };
    });

  return { version: 1, output: out, source, stack };
}

/** the schema section of the prompt, generated from the catalog (can't drift) */
function schemaLines(): string {
  return EFFECT_ORDER.map((type) => {
    const meta = EFFECT_CATALOG[type];
    const parts = meta.controls.map((c) => {
      if (c.kind === "slider") return `${c.key}: ${c.min}–${c.max}`;
      if (c.kind === "select") return `${c.key}: ${c.options.map((o) => o.value).join("|")}`;
      if (c.kind === "switch") return `${c.key}: bool`;
      if (c.kind === "color") return `${c.key}: #rrggbb`;
      if (c.kind === "text") return `${c.key}: string`;
      return `${c.key}: [{t:0..1,color:#rrggbb}, …]`;
    });
    return `  ${type}  { ${parts.join(", ")} }`;
  }).join("\n");
}

/** build the full prompt the user copies into Claude / any LLM */
export function buildPrompt(config: BgConfig): string {
  return `You are configuring a layered canvas "background editor". Return ONLY a JSON object
(no prose, no code fences) in exactly this shape — it replaces my current config:

{
  "version": 1,
  "output": { "aspect": "3:2"|"4:3"|"16:9"|"21:9"|"1:1"|"2:3"|"9:16" | {"w":N,"h":N}, "longEdge": 200-6000 },
  "source": { "mode": "image"|"solid", "imageId": string|null, "solidColor": "#rrggbb" },
  "stack": [ { "id": string, "type": EffectType, "enabled": bool, "params": {…} }, … ]
}

The stack is ordered top→bottom = render order; reorder by reordering the array.
Each effect's params (clamp values to these ranges):
${schemaLines()}

RULES
- Output the FULL config (keep ids you didn't change; invent short ids for new effects).
- Order matters — sequence the stack deliberately.
- Only use the EffectTypes and params listed above.

MY CURRENT CONFIG:
${JSON.stringify(config, null, 2)}

Now apply this change: <describe what you want here>`;
}
