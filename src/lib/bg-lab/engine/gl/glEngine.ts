// BG Lab — WebGL2 engine. Same RenderEngine contract as the CPU engine. The base
// (cover-fit source / solid) is composited on a 2D scratch canvas — reusing the
// exact CPU letterboxing — then uploaded as the first texture. Each effect then
// runs either as a GPU fragment pass (GL_OPS) over a ping-pong FBO chain, or, for
// ops that don't shader cleanly (blur/bloom/CMYK+FS-dither/shaped-pixelate/
// gradientMap with >8 stops + every glyph/converter style except kuwahara and
// lineArt, which have their own GL passes — see shaders.ts), through a CPU
// bridge: blit the current texture out, run the existing CPU op, re-upload.
// Correct for every op; GPU-accelerated for the portable ones.

import type { BgConfig, Dims, Effect, ParamValue } from "../../types";
import { unit } from "../../resolution";
import type { EngineSource, RenderEngine } from "../types";
import { ctx2d } from "../cpu/util";
import { drawTransformedSource } from "../cpu/sourceTransform";
import { drawPattern } from "../cpu/patterns";
import { OPS } from "../cpu/ops";
import { GLContext, type GLTexture } from "./glContext";
import { GL_OPS, type AssetTexKey } from "./shaders";
import { BLUE_NOISE_128, BLUE_NOISE_SIZE } from "../bluenoise";

const DEFAULT_BG = "#cdd9e0";

/** Ops that run on the CPU bridge instead of a GPU shader. */
function shouldBridge(eff: Effect): boolean {
  const t = eff.type;
  if (!t) return false;
  if (GL_OPS[t]) {
    // GL pass exists, but a few param modes still need the CPU path.
    if (t === "dither" && (eff.params.type === "floydSteinberg" || eff.params.type === "atkinson" || eff.params.type === "sierra")) return true;
    if (t === "pixelate" && eff.params.shape && eff.params.shape !== "square") return true;
    if (t === "gradientMap" && Array.isArray(eff.params.stops) && (eff.params.stops as unknown[]).length > 8) return true;
    return false;
  }
  return true; // no GPU pass → bridge to the CPU op
}

export class GLEngine implements RenderEngine {
  private src: EngineSource = null;
  private glc: GLContext;
  private a: GLTexture | null = null;
  private b: GLTexture | null = null;
  /** Cached composited base (see render). Never a ping-pong write target. */
  private baseTex: GLTexture | null = null;
  private baseSig: string | null = null;
  private baseRef: unknown = null;
  private base: HTMLCanvasElement | null = null;
  private bridge: HTMLCanvasElement | null = null;
  private t0 = 0;
  /** F4 asset-texture cache: sampler-only textures for GpuPass.samplers. */
  private assets = new Map<AssetTexKey, WebGLTexture>();

  constructor() {
    this.glc = new GLContext();
    if (process.env.NODE_ENV !== "production") this.selfCheck();
  }

  /** Dev-only: compile every GL_OPS pass so a broken shader logs loudly instead
   * of silently bridging/falling back at render time. Also pre-warms the
   * program cache. One failure must not stop the rest from being checked. */
  private selfCheck() {
    for (const [type, pass] of Object.entries(GL_OPS)) {
      try {
        this.glc.program(pass!.frag);
      } catch (err) {
        console.error(`[bg-lab] GL pass '${type}' failed to compile:`, err);
      }
    }
  }

  setSource(src: EngineSource) {
    this.src = src;
  }

  private ensureBuffers(W: number, H: number) {
    if (this.a && this.a.w === W && this.a.h === H) return;
    const gl = this.glc.gl;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (W > max || H > max) throw new Error("gl-dims-too-large");
    if (this.a) gl.deleteTexture(this.a.tex), gl.deleteFramebuffer(this.a.fbo);
    if (this.b) gl.deleteTexture(this.b.tex), gl.deleteFramebuffer(this.b.fbo);
    if (this.baseTex) gl.deleteTexture(this.baseTex.tex), gl.deleteFramebuffer(this.baseTex.fbo);
    this.a = this.glc.createTexture(W, H);
    this.b = this.glc.createTexture(W, H);
    this.baseTex = this.glc.createTexture(W, H);
    this.baseSig = null; // buffer contents are gone — force a recomposite
  }

  private scratch(which: "base" | "bridge", W: number, H: number): HTMLCanvasElement {
    let c = which === "base" ? this.base : this.bridge;
    if (!c) {
      c = document.createElement("canvas");
      if (which === "base") this.base = c;
      else this.bridge = c;
    }
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    return c;
  }

  render(target: HTMLCanvasElement, config: BgConfig, dims: Dims, time?: number) {
    const { W, H } = dims;
    const gl = this.glc.gl;
    this.glc.resize(W, H);
    this.ensureBuffers(W, H);
    if (!this.t0) this.t0 = performance.now();
    const t = time ?? (performance.now() - this.t0) / 1000;

    // --- base: composite source on a 2D scratch (exact CPU letterboxing), upload.
    // The composited base is cached in `baseTex`: for a static source (image /
    // pattern / solid) the 2D composite + full texImage2D upload only happen when
    // the source, transform, or dims change — animated stacks (grain `animate`
    // etc.) otherwise pay that CPU+upload cost on every rAF frame for identical
    // pixels. Video always recomposites (each frame differs). The per-frame cost
    // when cached is one GPU-side blit (glc.copy) into the ping-pong chain.
    const u = unit(W);
    const isVideo = this.src?.kind === "video";
    const sig = JSON.stringify({
      k: this.src?.kind ?? "none",
      t: config.source.transform ?? null,
      p: this.src?.kind === "pattern" ? this.src.pattern : null,
      c: this.src?.kind === "solid" ? this.src.color : null,
      W,
      H,
    });
    const ref = this.src?.kind === "image" ? this.src.image : this.src?.kind === "video" ? this.src.video : null;
    if (isVideo || sig !== this.baseSig || ref !== this.baseRef) {
      const base = this.scratch("base", W, H);
      const bctx = ctx2d(base);
      bctx.clearRect(0, 0, W, H);
      if (this.src && (this.src.kind === "image" || this.src.kind === "video")) {
        const im = this.src.kind === "image" ? this.src.image : (this.src as { video: HTMLVideoElement }).video;
        const iw = ((im as { width?: number; videoWidth?: number }).videoWidth || (im as { width?: number }).width || W) as number;
        const ih = ((im as { height?: number; videoHeight?: number }).videoHeight || (im as { height?: number }).height || H) as number;
        try {
          drawTransformedSource(bctx, base, im as CanvasImageSource, iw, ih, W, H, config.source.transform);
        } catch {
          /* video not ready yet — leave cleared */
        }
      } else if (this.src && this.src.kind === "pattern") {
        drawPattern(bctx, W, H, this.src.pattern, u);
      } else {
        bctx.fillStyle = this.src && this.src.kind === "solid" ? this.src.color : DEFAULT_BG;
        bctx.fillRect(0, 0, W, H);
      }
      this.glc.uploadExternal(this.baseTex!, base);
      this.baseSig = sig;
      this.baseRef = ref;
    }
    let cur = this.a!,
      other = this.b!;
    this.glc.copy(this.baseTex!, cur);

    // --- stack
    for (const eff of config.stack) {
      if (!eff.enabled || !eff.type) continue;
      if (shouldBridge(eff)) {
        const op = OPS[eff.type];
        if (!op) continue;
        this.glc.present(cur); // blit current → default FB (upright)
        const br = this.scratch("bridge", W, H);
        const brctx = ctx2d(br);
        brctx.clearRect(0, 0, W, H);
        brctx.drawImage(this.glc.canvas, 0, 0);
        op(br, eff.params, u, t);
        this.glc.uploadExternal(cur, br);
        continue;
      }
      const pass = GL_OPS[eff.type]!;
      const prog = this.glc.program(pass.frag);
      const reads = [{ name: "u_tex", tex: cur.tex }];
      if (pass.samplers) for (const s of pass.samplers) reads.push({ name: s.name, tex: this.assetTex(s.key) });
      this.glc.pass(prog, other, reads, (g, pr) => {
        setCommon(this.glc, g, pr, W, H, u, t);
        pass.setUniforms(g, pr, eff.params as Record<string, ParamValue>, u, t, { w: W, h: H });
      });
      const tmp = cur;
      cur = other;
      other = tmp;
    }

    // --- present + copy to the (2D) target canvas
    this.glc.present(cur);
    // Guard against implicit canvas reset on same-value width/height reassignment (HTML spec).
    // Safe here: the explicit clearRect + full-canvas drawImage below cover it.
    if (target.width !== W) target.width = W;
    if (target.height !== H) target.height = H;
    const tctx = ctx2d(target);
    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(this.glc.canvas, 0, 0);
  }

  /** Lazily build + cache an F4 asset texture. Keys are compile-time enumerable
   * (AssetTexKey), so an unknown key is a type error, not a runtime miss. */
  private assetTex(key: AssetTexKey): WebGLTexture {
    const hit = this.assets.get(key);
    if (hit) return hit;
    // single case for now; extend per key as F4 consumers land (ASCII atlas…)
    const tex = this.glc.createAssetTextureR8(BLUE_NOISE_SIZE, BLUE_NOISE_SIZE, BLUE_NOISE_128);
    this.assets.set(key, tex);
    return tex;
  }

  dispose() {
    const gl = this.glc.gl;
    this.assets.forEach((t) => gl.deleteTexture(t));
    this.assets.clear();
    if (this.a) gl.deleteTexture(this.a.tex), gl.deleteFramebuffer(this.a.fbo);
    if (this.b) gl.deleteTexture(this.b.tex), gl.deleteFramebuffer(this.b.fbo);
    if (this.baseTex) gl.deleteTexture(this.baseTex.tex), gl.deleteFramebuffer(this.baseTex.fbo);
    this.a = this.b = this.baseTex = null;
    this.baseSig = null;
    this.baseRef = null;
    this.glc.dispose();
    this.src = null;
  }
}

function setCommon(glc: GLContext, gl: WebGL2RenderingContext, prog: WebGLProgram, W: number, H: number, u: number, t: number) {
  const l1 = glc.loc(prog, "u_texel");
  if (l1) gl.uniform2f(l1, 1 / W, 1 / H);
  const l2 = glc.loc(prog, "u_dims");
  if (l2) gl.uniform2f(l2, W, H);
  const l3 = glc.loc(prog, "u_unit");
  if (l3) gl.uniform1f(l3, u);
  const l4 = glc.loc(prog, "u_time");
  if (l4) gl.uniform1f(l4, t);
}
