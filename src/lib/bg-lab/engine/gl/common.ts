// BG Lab — shared GL pass plumbing. Each pass entry is a fragment shader plus a
// uniform setter; the engine runs them as single fragment passes over the
// ping-pong chain (or, for `multi` ops, N same-size steps via MultiPassCtx —
// see blur/bloom/characterBloom below). Ops NOT listed here (CMYK/
// error-diffusion dither, shaped pixelate, and gradient maps with >8 stops)
// run through the CPU bridge instead — see glEngine.shouldBridge. The 8
// glyph-family EffectTypes (ascii/blockChars/crosshatch/diagonal/diamond/
// lines/mixed/glyphDots) share one GL pass (`glyphs`, below) for their common
// param configurations; exotic modes (background transparent/blurred,
// non-normal blendMode, dotGrid, randomize) still bridge — see
// glEngine.shouldBridge's glyph gating.

import type { ParamValue } from "../../types";
import { hexRGB, ps } from "../cpu/util";

/** F4: named asset textures a pass can sample (bound after u_tex, in order).
 * Keys resolve via glEngine's asset cache — sampler-only textures (no FBO). */
export type AssetTexKey = "blueNoise128";

/** F5a: executor handed to multi-pass ops. All targets are same-size (W×H).
 * `input` is the op's source in the ping-pong chain (read-only), `output` is
 * where the FINAL step must land; `temp(name)` returns pooled intermediates;
 * `run` executes one fragment step (common uniforms u_texel/u_dims/u_unit/
 * u_time are set automatically; per-step uniforms via `set`). */
export interface MultiPassCtx {
  input: { tex: WebGLTexture };
  output: { tex: WebGLTexture };
  /** Pooled temp render target. Defaults to the op's full W×H; pass w/h for
   * sized temps (F5b mip chains — dual bloom). Common uniforms (u_dims,
   * u_texel) always describe the DESTINATION being rendered into. */
  temp: (name: string, w?: number, h?: number) => { tex: WebGLTexture };
  run: (
    frag: string,
    dst: { tex: WebGLTexture },
    reads: { name: string; tex: WebGLTexture }[],
    set?: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void,
  ) => void;
}

/** Ctx for GpuPass.pre — a reduction step before the main frag. Same `temp`/
 * `run` contract as MultiPassCtx, plus `read`: a synchronous RGBA8 readback of
 * a temp that was just rendered. Read targets should be SMALL (a per-cell
 * lattice, not W×H) — the readback stalls the pipeline, which is fine for a
 * few-hundred-KB grid and defeats the point for a full frame. */
export interface PrePassCtx {
  input: { tex: WebGLTexture };
  temp: (name: string, w: number, h: number) => { tex: WebGLTexture };
  run: (
    frag: string,
    dst: { tex: WebGLTexture },
    reads: { name: string; tex: WebGLTexture }[],
    set?: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void,
  ) => void;
  read: (src: { tex: WebGLTexture }) => Uint8Array;
}

export interface GpuPass {
  /** Single-pass fragment source. Exactly one of `frag` / `multi` is set. */
  frag?: string;
  /** Extra sampler bindings: uniform `name` reads asset `key` (single-pass). */
  samplers?: { name: string; key: AssetTexKey }[];
  /** Optional pre-pass for single-pass ops: runs a reduction + readback before
   * the main frag and returns extra uniform values, handed to setUniforms as
   * its trailing `pre` argument (glyphs autoContrast percentile stretch). */
  pre?: (ctx: PrePassCtx, p: Record<string, ParamValue>, u: number, t: number, dims: { w: number; h: number }) => Record<string, number>;
  setUniforms?: (gl: WebGL2RenderingContext, prog: WebGLProgram, p: Record<string, ParamValue>, u: number, t: number, dims: { w: number; h: number }, pre?: Record<string, number>) => void;
  /** F5a multi-pass body: run N same-size steps via the ctx. */
  multi?: (ctx: MultiPassCtx, p: Record<string, ParamValue>, u: number, t: number, dims: { w: number; h: number }) => void;
  /** Static list of every frag a `multi` op can run — dev self-check compiles
   * these at startup (single-pass ops are checked via `frag`; ops with a `pre`
   * hook list their auxiliary reduction frags here too). */
  frags?: string[];
  /** Param-dependent sampler textures (e.g. glyph atlases). Resolved per render:
   * `sig` keys a cache — when it changes, `build` runs once and the previous
   * texture for this `name` is deleted. Sampler-only (NEAREST, CLAMP), no FBO. */
  dynamicSamplers?: (
    p: Record<string, ParamValue>,
    u: number,
    dims: { w: number; h: number },
  ) => { name: string; sig: string; build: () => HTMLCanvasElement }[];
}

export const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform vec2 u_dims;
uniform float u_unit;
uniform float u_time;
out vec4 o;
float luma601(vec3 c){ return 0.299*c.r+0.587*c.g+0.114*c.b; }
float luma709(vec3 c){ return 0.2126*c.r+0.7152*c.g+0.0722*c.b; }
// --- F2 prelude: linear-light (cheap pow 2.2), rotation, fwidth AA mask ---
// NOTE: linear light is for AVERAGING/COMPOSITING only — never for tone→coverage
// (gamma-correcting coverage over-inks mid-tones; halftone/dither coverage stays sRGB).
vec3  toLin(vec3 s){ return pow(max(s,0.0), vec3(2.2)); }
vec3  toSRGB(vec3 l){ return pow(max(l,0.0), vec3(1.0/2.2)); }
mat2  rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
float aaMask(float d){ float w=max(fwidth(d),1e-4); return 1.0-smoothstep(-w,w,d); }
// --- F3 prelude: iq 2D SDFs (https://iquilezles.org/articles/distfunctions2d/) ---
float sdCircle(vec2 p, float r){ return length(p)-r; }
float sdBox(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }
float sdDiamond(vec2 p, float r){ return (abs(p.x)+abs(p.y))-r; }     // L1 ball
float sdRing(vec2 p, float r, float w){ return abs(length(p)-r)-w; }  // annulus
`;

export const f = (body: string) => HEADER + body;
export const col = (p: Record<string, ParamValue>, k: string, d: string): [number, number, number] => {
  const [r, g, b] = hexRGB(ps(p, k, d));
  return [r / 255, g / 255, b / 255];
};
// Per-program uniform-location cache (self-cleaning: WeakMap keyed off the program).
// Caches null too — a missing uniform re-queries otherwise, once per pass per frame.
export const LOCS = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
export const loc = (gl: WebGL2RenderingContext, prog: WebGLProgram, n: string) => {
  let m = LOCS.get(prog);
  if (!m) LOCS.set(prog, (m = new Map()));
  if (m.has(n)) return m.get(n)!;
  const l = gl.getUniformLocation(prog, n);
  m.set(n, l);
  return l;
};

// ---------------------------------------------------------------- copy (identity passthrough)
// F5a multi-pass ops always run their final step into ctx.output — the engine
// unconditionally ping-pongs — so an op's identity case (radius/intensity<=0,
// matching the CPU op's early `return`) still needs one GPU copy step.
export const COPY_FRAG = f(`void main(){ o=texture(u_tex,v_uv); }`);
