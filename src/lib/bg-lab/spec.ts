// BG Lab — "Copy spec": a hand-off document for a dev agent. A readable
// summary of everything that shapes the rendered result (source asset,
// playhead, crop/rotate, output size, the ordered stack with every param that
// differs from its default), followed by the exact BgConfig JSON. The JSON is
// the source of truth; the summary is derived from it.

import { EFFECT_CATALOG, defaultParams, type ControlSpec } from "./catalog";
import { EXAMPLES, GALLERY, TEXTURES, exampleSourceId, galleryUrl, presetBySlug } from "./presets";
import { PATTERN_APPLIES, PATTERN_CONTROLS, PATTERN_TYPE_LABEL } from "./patternCatalog";
import { GRADIENT_APPLIES, GRADIENT_CONTROLS, GRADIENT_TYPE_LABEL } from "./gradientCatalog";
import { outputDims } from "./resolution";
import type { BgConfig, GradientStop, ParamValue, SourceState } from "./types";

/** Live playback state of a video source — not part of BgConfig, but it
 * decides which frame the preview shows. */
export interface VideoPlayback {
  time: number;
  duration: number;
  rate: number;
  paused: boolean;
  loop: boolean;
}

const isStops = (v: ParamValue): v is GradientStop[] => Array.isArray(v);

function fmtValue(v: ParamValue): string {
  if (isStops(v)) return v.map((s) => `${s.color} @ ${s.t}`).join(", ");
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

const same = (a: ParamValue | undefined, b: ParamValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

/** A knob absent from the APPLIES table applies to every type. */
const appliesTo = <T extends string>(table: Partial<Record<string, T[]>>, key: string, type: T) =>
  !table[key] || table[key]!.includes(type);

function controlLabel(controls: ControlSpec[], key: string): string {
  const c = controls.find((x) => x.key === key);
  return c ? `${c.label} (\`${key}\`)` : `\`${key}\``;
}

/** Size-bearing sliders (`unit: true`) are multiplied by W/1000 at render
 * time (resolution.ts unit()), so the raw value isn't pixels — spell out the
 * pixel size at the export width. */
function sizeNote(c: ControlSpec, v: ParamValue | undefined, W: number): string {
  if (c.kind !== "slider" || !c.unit || typeof v !== "number") return "";
  return ` → ${+(v * (W / 1000)).toFixed(2)}px at ${W}px wide`;
}

function describeAsset(source: SourceState): string[] {
  const id = source.imageId;
  const kind = source.mode === "video" ? "video" : "image";
  if (!id) return [`- Asset: none (empty ${kind} source)`];
  const g = [...GALLERY, ...TEXTURES].find((x) => galleryUrl(id) === x.url);
  if (g) return [`- Asset: built-in ${TEXTURES.includes(g) ? "texture" : "gallery image"} "${g.label}" (\`${id}\`) — \`public${g.url}\``];
  if (id.startsWith("pexels:")) {
    const isVideo = id.startsWith("pexels:video:");
    const file = id.slice(isVideo ? "pexels:video:".length : "pexels:".length);
    const lines = [`- Asset: Pexels ${isVideo ? "video" : "photo"} — ${file}`];
    // The imageId stores the CDN file only. Built-in examples carry their exact
    // page + credit; for any other Pexels pick, the numeric id in the file path
    // is the stable handle (API: GET /videos/videos/<id> or /v1/photos/<id>).
    const pid = /\/(?:video-files|photos)\/(\d+)\//.exec(file)?.[1];
    const example = EXAMPLES.find((e) => exampleSourceId(e) === id);
    if (example) {
      const preset = presetBySlug(example.preset)?.name ?? example.preset;
      lines.push(`- Pexels page: ${example.page} — by ${example.credit}`);
      lines.push(`- Built-in example: "${example.subject}" (\`${example.slug}\`, paired with the ${preset} preset)`);
      lines.push(`- Poster frame: ${example.poster}`);
    } else if (pid) {
      lines.push(`- Pexels ${isVideo ? "video" : "photo"} id: ${pid}`);
    }
    lines.push(`- The JSON's \`source.imageId\` carries this file URL (\`pexels:${isVideo ? "video:" : ""}<url>\`); the CDN serves it with CORS \`*\`, so it loads directly.`);
    return lines;
  }
  if (id.startsWith("blob:") || id.startsWith("data:")) {
    return [
      `- Asset: local upload (${kind}). Its URL only resolves in the browser tab it was dropped into — attach the original file alongside this spec.`,
    ];
  }
  return [`- Asset: ${id}`];
}

function describeSource(
  source: SourceState,
  video: VideoPlayback | null,
  sourceSize: { w: number; h: number } | null,
  W: number,
): string[] {
  const lines: string[] = [`- Mode: ${source.mode}`];
  if (source.mode === "image" || source.mode === "video") {
    lines.push(...describeAsset(source));
    if (sourceSize) lines.push(`- Source pixels: ${sourceSize.w}×${sourceSize.h}`);
    if (source.mode === "video" && video) {
      lines.push(
        `- Playhead: ${video.time.toFixed(2)}s of ${video.duration.toFixed(2)}s · speed ${video.rate}× · ${video.paused ? "paused" : "playing"} · loop ${video.loop ? "on" : "off"}`,
      );
    }
    const t = source.transform;
    const parts: string[] = [];
    if (t?.rotate) parts.push(`rotate ${t.rotate}°`);
    if (t?.flipH) parts.push("flipped horizontally");
    if (t?.crop) {
      const c = t.crop;
      parts.push(`crop x ${c.x.toFixed(4)} y ${c.y.toFixed(4)} w ${c.w.toFixed(4)} h ${c.h.toFixed(4)} (normalized 0..1, in the rotated source's space)`);
    }
    lines.push(`- Crop / rotate: ${parts.length ? parts.join(" · ") : "none"}`);
    lines.push("- Fit: cover — after crop/rotate, scaled to fill the output frame, centered, overflow cropped");
  } else if (source.mode === "solid") {
    lines.push(`- Color: ${source.solidColor}`);
  } else if (source.mode === "pattern" && source.pattern) {
    const p = source.pattern;
    lines.push(`- Pattern: ${PATTERN_TYPE_LABEL[p.type]} (\`${p.type}\`)`);
    for (const c of PATTERN_CONTROLS) {
      if (c.key === "type" || !appliesTo(PATTERN_APPLIES, c.key, p.type)) continue;
      const v = (p as unknown as Record<string, ParamValue>)[c.key];
      if (v !== undefined) lines.push(`  - ${controlLabel(PATTERN_CONTROLS, c.key)}: ${fmtValue(v)}${sizeNote(c, v, W)}`);
    }
  } else if (source.mode === "gradient" && source.gradient) {
    const g = source.gradient;
    lines.push(`- Gradient: ${GRADIENT_TYPE_LABEL[g.type]} (\`${g.type}\`)`);
    for (const c of GRADIENT_CONTROLS) {
      if (c.key === "type" || !appliesTo(GRADIENT_APPLIES, c.key, g.type)) continue;
      if (c.key === "stops" && g.type === "mesh") continue; // mesh reads its 4 corners, not the ramp
      const v = (g as unknown as Record<string, ParamValue>)[c.key];
      if (v !== undefined) lines.push(`  - ${controlLabel(GRADIENT_CONTROLS, c.key)}: ${fmtValue(v)}`);
    }
    if (g.type === "mesh" && g.mesh) lines.push(`  - Mesh corners TL, TR, BR, BL (\`mesh\`): ${g.mesh.join(", ")}`);
  }
  return lines;
}

function describeStack(config: BgConfig, W: number): string[] {
  if (!config.stack.length) return ["(no effects — the source renders as-is)"];
  return config.stack.map((e, i) => {
    if (!e.type) return `${i + 1}. (empty slot — skipped by the renderer)`;
    const meta = EFFECT_CATALOG[e.type];
    const defaults = defaultParams(e.type);
    // Params gated off by an unmet showIf never reach the render — skip them.
    const changed = meta.controls
      .filter((c) => !c.showIf || c.showIf.in.includes(e.params[c.showIf.key]))
      .filter((c) => !same(e.params[c.key], defaults[c.key]))
      .map(
        (c) =>
          `   - ${controlLabel(meta.controls, c.key)}: ${fmtValue(e.params[c.key])}${sizeNote(c, e.params[c.key], W)} (default ${fmtValue(defaults[c.key])})`,
      );
    const head = `${i + 1}. ${meta.label} (\`${e.type}\`)${e.enabled ? "" : " — DISABLED, skipped by the renderer"}`;
    return [head, ...(changed.length ? changed : ["   - all params at default"])].join("\n");
  });
}

/** Markdown hand-off: readable summary + the exact config JSON. */
export function buildSpec(
  config: BgConfig,
  opts: { name: string; video: VideoPlayback | null; sourceSize: { w: number; h: number } | null },
): string {
  const { aspect, longEdge } = config.output;
  const dims = outputDims(aspect, longEdge);
  const aspectLabel = typeof aspect === "string" ? aspect : `custom ${aspect.w}:${aspect.h}`;

  return [
    `# Shader Lab spec — ${opts.name}`,
    "",
    "Exact editor state from Shader Lab. The JSON at the bottom is the full `BgConfig` (`src/lib/bg-lab/types.ts`) and is the source of truth; the summary is derived from it. `validateConfig` in `src/lib/bg-lab/schema.ts` parses it.",
    "",
    "## Source",
    ...describeSource(config.source, opts.video, opts.sourceSize, dims.W),
    "",
    "## Output",
    `- Aspect ${aspectLabel} · long edge ${longEdge}px → ${dims.W}×${dims.H}px`,
    "- The live preview renders the same config at up to 1100px on the long edge; size params scale with width, so it's proportionally identical to the export.",
    "",
    "## Effect stack (render order, top → bottom)",
    "Only params that differ from the catalog default are listed; the JSON has every value. Size params are in units of output width ÷ 1000, not pixels — the arrow gives the pixel size at the export width.",
    "",
    ...describeStack(config, dims.W),
    "",
    "## Config JSON",
    "```json",
    JSON.stringify(config, null, 2),
    "```",
    "",
  ].join("\n");
}
