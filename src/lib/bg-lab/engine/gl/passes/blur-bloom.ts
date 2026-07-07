// BG Lab GL passes — blur / bloom / characterBloom multi-pass family. Moved
// verbatim from shaders.ts.

import { pn, ps } from "../../cpu/util";
import { COPY_FRAG, type GpuPass, type MultiPassCtx, f, loc } from "../common";

// ---------------------------------------------------------------- blur (multi-pass)
// Mirrors cpu/ops.ts `blur` exactly in its deterministic geometry/weights;
// the only intentional divergence is the gaussian *shape* itself (canvas
// `ctx.filter = blur(r)` is a Skia-approximated gaussian, GL runs a true
// separable gaussian with sigma=r) — see PARITY DOCTRINE at the top of this
// task's harness notes. All four modes share u_dims/u_texel/u_unit already
// bound by MultiPassCtx.run's common-uniform setter.
//
// Shared separable gaussian pass, parameterized by u_zoom (overscan resample,
// CPU's `drawImage(snap,-r,-r,W+2r,H+2r)`) and u_horiz (H vs V direction).
// Zoom inverse-maps dest px -> source px: sx = (dx+r)*W/(W+2r) (see task
// notes derivation); with zoom, the sampled sx/sy always lands in [0,W]x[0,H]
// (the overscan draw guarantees full source coverage with margin), so no
// edge-fade is needed — unlike bloom's zero-padded variant below.
// N_MAX=64 is a constant loop bound (GLSL ES 3.00 requires compile-time loop
// bounds); u_taps <= 64 always (radius is UI-capped at 40*unit, and
// step = max(1, 3*sigma/64) keeps N = ceil(3*sigma) taps capped at 64).
const GAUSS_FRAG = f(`const int N_MAX = 64;
uniform float u_sigma;
uniform int u_taps;     // min(64, ceil(3*sigma))
uniform float u_step;   // px per tap, >= 1
uniform float u_horiz;  // 1 = horizontal pass, 0 = vertical
uniform float u_zoom;   // 1 = overscan resample (CPU's -r,-r,W+2r,H+2r draw), 0 = direct
uniform float u_r;      // overscan radius (only used when u_zoom>0)
void main(){
  vec4 c0 = texture(u_tex, v_uv);
  if(u_sigma<=0.0){ o=c0; return; }
  // dest pixel, canvas top-left-origin space
  vec2 px = vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for(int i=-N_MAX; i<=N_MAX; i++){
    if(abs(i)>u_taps) continue;
    float d = float(i)*u_step;
    float w = exp(-0.5*(d/u_sigma)*(d/u_sigma));
    vec2 sp = px + (u_horiz>0.5 ? vec2(d,0.0) : vec2(0.0,d));
    vec2 srcPx;
    if(u_zoom>0.5){
      // inverse of drawImage(snap,-r,-r,W+2r,H+2r): sx=(dx+r)*W/(W+2r)
      srcPx = (sp + u_r) * u_dims / (u_dims + 2.0*u_r);
    } else {
      srcPx = sp;
    }
    vec2 uv = vec2(srcPx.x/u_dims.x, 1.0-srcPx.y/u_dims.y);
    acc += texture(u_tex, uv).rgb * w;
    wsum += w;
  }
  o = vec4(acc/max(wsum,1e-6), c0.a);
}`);

// Directional blur: single step, 14 equal-weight taps along (cos,sin)*r,
// renormalized over in-bounds samples (CPU's incremental 1/(i+1) globalAlpha
// average is mathematically an equal-weight mean over drawn — i.e. in-bounds
// — copies; out-of-bounds copies contribute transparent pixels that don't
// change the running average once renormalized). v_uv +y is up, canvas +y is
// down, so the y offset is negated before applying to v_uv.
const DIRECTIONAL_FRAG = f(`uniform vec2 u_off; // (dx,dy) in canvas px for tap 13 (max t)
void main(){
  vec4 c0 = texture(u_tex, v_uv);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for(int i=0;i<14;i++){
    float tt = (float(i)/13.0 - 0.5)*2.0;
    vec2 offPx = u_off*tt;
    vec2 uv = v_uv + vec2(offPx.x, -offPx.y)*u_texel;
    if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) continue;
    acc += texture(u_tex, uv).rgb;
    wsum += 1.0;
  }
  if(wsum<=0.0){ o=c0; return; }
  o = vec4(acc/wsum, c0.a);
}`);

// Radial (zoom) blur: single step, 14 equal-weight scaled copies s_i = 1 + k*(i/13),
// all s>=1 so the inverse sample ctr + (p-ctr)/s_i is always in-bounds — no
// renormalization needed (matches CPU: every copy is fully opaque/in-bounds).
const RADIAL_FRAG = f(`uniform float u_k; // r / max(W,H)
void main(){
  vec2 px = vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y);
  vec2 ctr = 0.5*u_dims;
  vec3 acc = vec3(0.0);
  for(int i=0;i<14;i++){
    float s = 1.0 + u_k*(float(i)/13.0);
    vec2 sp = ctr + (px-ctr)/s;
    vec2 uv = vec2(sp.x/u_dims.x, 1.0-sp.y/u_dims.y);
    acc += texture(u_tex, uv).rgb;
  }
  o = vec4(acc/14.0, texture(u_tex, v_uv).a);
}`);

// TiltShift combine: mix(blurred, sharp, mask(y)) where mask is the CPU's
// clamped-stop linear gradient (createLinearGradient with 4 stops, each
// clamped to [0,1] of canvas height) — piecewise-linear ramp 0->1->1->0 over
// [cy-half-feather, cy-half, cy+half, cy+half+feather]. u_tex = blurred temp,
// u_sharp = original input.
const TILTSHIFT_COMBINE_FRAG = f(`uniform sampler2D u_sharp;
uniform float u_stop0, u_stop1, u_stop2, u_stop3; // clamped [0,1] gradient stops (canvas y/H)
float rampAt(float y01){
  if(y01<=u_stop0) return 0.0;
  if(y01<u_stop1) return u_stop1>u_stop0 ? (y01-u_stop0)/(u_stop1-u_stop0) : 1.0;
  if(y01<=u_stop2) return 1.0;
  if(y01<u_stop3) return u_stop3>u_stop2 ? 1.0-(y01-u_stop2)/(u_stop3-u_stop2) : 0.0;
  return 0.0;
}
void main(){
  vec4 blurred = texture(u_tex, v_uv);
  vec4 sharp = texture(u_sharp, v_uv);
  float y01 = (1.0-v_uv.y); // canvas-space y/H (top-down)
  float m = rampAt(y01);
  o = vec4(mix(blurred.rgb, sharp.rgb, m), blurred.a);
}`);

const BLUR_FRAGS = [COPY_FRAG, GAUSS_FRAG, DIRECTIONAL_FRAG, RADIAL_FRAG, TILTSHIFT_COMBINE_FRAG];

function gaussTaps(sigma: number): { taps: number; step: number } {
  const taps = Math.min(64, Math.ceil(3 * sigma));
  const step = Math.max(1, (3 * sigma) / 64);
  return { taps, step };
}

function runGauss(
  ctx: MultiPassCtx,
  src: { tex: WebGLTexture },
  dst: { tex: WebGLTexture },
  sigma: number,
  horiz: boolean,
  zoom: boolean,
  r: number,
) {
  const { taps, step } = gaussTaps(sigma);
  ctx.run(GAUSS_FRAG, dst, [{ name: "u_tex", tex: src.tex }], (gl, prog) => {
    gl.uniform1f(loc(gl, prog, "u_sigma"), sigma);
    gl.uniform1i(loc(gl, prog, "u_taps"), taps);
    gl.uniform1f(loc(gl, prog, "u_step"), step);
    gl.uniform1f(loc(gl, prog, "u_horiz"), horiz ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_zoom"), zoom ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_r"), r);
  });
}

export const blur: GpuPass = {
  frags: BLUR_FRAGS,
  multi: (ctx, p, u, t, dims) => {
    const r = Math.max(0, pn(p, "radius", 6) * u);
    const mode = ps(p, "mode", "gaussian");
    if (r <= 0) {
      // identity: engine always swaps, so copy input -> output explicitly.
      ctx.run(COPY_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }]);
      return;
    }
    if (mode === "directional") {
      const ang = (pn(p, "angle", 0) * Math.PI) / 180;
      const dx = Math.cos(ang) * r,
        dy = Math.sin(ang) * r;
      ctx.run(DIRECTIONAL_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
        gl.uniform2f(loc(gl, prog, "u_off"), dx, dy);
      });
      return;
    }
    if (mode === "radial") {
      const W = dims.w,
        H = dims.h;
      const k = r / Math.max(W, H);
      ctx.run(RADIAL_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
        gl.uniform1f(loc(gl, prog, "u_k"), k);
      });
      return;
    }
    if (mode === "tiltShift") {
      const H = dims.h;
      const blurH = ctx.temp("blurH");
      const blurV = ctx.temp("blurV");
      // zoom only in H: GAUSS_FRAG's overscan map rescales BOTH axes, so the
      // V pass over the already-zoomed intermediate must not re-apply it.
      runGauss(ctx, ctx.input, blurH, r, true, true, r);
      runGauss(ctx, blurH, blurV, r, false, false, 0);
      const center = pn(p, "center", 0.5);
      const band = pn(p, "band", 0.3);
      const cy = center * H,
        half = (band * H) / 2,
        feather = half * 0.7;
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
      const s0 = clamp01((cy - half - feather) / H);
      const s1 = clamp01((cy - half) / H);
      const s2 = clamp01((cy + half) / H);
      const s3 = clamp01((cy + half + feather) / H);
      ctx.run(
        TILTSHIFT_COMBINE_FRAG,
        ctx.output,
        [
          { name: "u_tex", tex: blurV.tex },
          { name: "u_sharp", tex: ctx.input.tex },
        ],
        (gl, prog) => {
          gl.uniform1f(loc(gl, prog, "u_stop0"), s0);
          gl.uniform1f(loc(gl, prog, "u_stop1"), s1);
          gl.uniform1f(loc(gl, prog, "u_stop2"), s2);
          gl.uniform1f(loc(gl, prog, "u_stop3"), s3);
        },
      );
      return;
    }
    // gaussian (default): 2-pass separable, with overscan zoom (H only — the
    // frag's zoom map rescales both axes; re-applying it in V doubles it).
    const blurH = ctx.temp("blurH");
    runGauss(ctx, ctx.input, blurH, r, true, true, r);
    runGauss(ctx, blurH, ctx.output, r, false, false, 0);
  },
};

// ---------------------------------------------------------------- bloom / characterBloom (multi-pass)
// Both CPU ops (ops.ts `bloom`, postfx.ts `characterBloom`) are byte-identical
// 4-step pipelines differing only in default param values — so the GL side
// shares one set of frags/step-runner and each op only supplies its own
// uniform values (threshold/intensity/radius defaults).
//
// Step 1: bright-extract. Snap to 8-bit ints (matching CPU's Uint8ClampedArray
// canvas backing) before comparing against thr*255, exactly like the CPU op's
// `luma601(bd[i],bd[i+1],bd[i+2]) < thr` on already-8-bit imageData.
const BLOOM_BRIGHT_FRAG = f(`uniform float u_thr255;
void main(){
  vec3 c8 = floor(texture(u_tex,v_uv).rgb*255.0+0.5);
  float l = luma601(c8);
  vec3 rgb = l < u_thr255 ? vec3(0.0) : c8/255.0;
  o = vec4(rgb, 1.0);
}`);

// Steps 2/3: separable gaussian on the bright pass, NO overscan zoom and
// ZERO-PADDING at the edges (matches the CPU's canvas blur of a bright layer
// drawn at (0,0) with no overscan: samples outside the canvas are
// transparent black, fading the blurred edges toward transparent). Premultiplied
// accumulation: rgbSum/wTotal in rgb, aSum/wTotal in alpha, both divided by
// the FULL tap weight total (including out-of-bounds taps) so edges fade
// exactly like the canvas compositing does.
const BLOOM_GAUSS_FRAG = f(`const int N_MAX = 64;
uniform float u_sigma;
uniform int u_taps;
uniform float u_step;
uniform float u_horiz;
void main(){
  vec2 px = vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y);
  vec3 rgbSum = vec3(0.0);
  float aSum = 0.0;
  float wTotal = 0.0;
  for(int i=-N_MAX; i<=N_MAX; i++){
    if(abs(i)>u_taps) continue;
    float d = float(i)*u_step;
    float w = exp(-0.5*(d/u_sigma)*(d/u_sigma));
    wTotal += w;
    vec2 sp = px + (u_horiz>0.5 ? vec2(d,0.0) : vec2(0.0,d));
    if(sp.x<0.0||sp.x>=u_dims.x||sp.y<0.0||sp.y>=u_dims.y) continue; // zero-pad: no contribution
    vec2 uv = vec2(sp.x/u_dims.x, 1.0-sp.y/u_dims.y);
    vec4 s = texture(u_tex, uv);
    rgbSum += s.rgb*w;   // premultiplied-by-weight accumulation
    aSum += s.a*w;
  }
  o = vec4(rgbSum/max(wTotal,1e-6), aSum/max(wTotal,1e-6));
}`);

// Step 4: screen-composite. Src (blurred bright pass) is premultiplied
// (pr,pa); unpremultiply to get s, then screen-blend over base with
// globalAlpha = pa*clamp(intensity,0,1) — matches canvas
// `globalCompositeOperation="screen"` + `globalAlpha=intensity` over an
// opaque base.
const BLOOM_COMPOSITE_FRAG = f(`uniform sampler2D u_blurred;
uniform float u_intensity;
void main(){
  vec4 base = texture(u_tex, v_uv);
  vec4 src = texture(u_blurred, v_uv);
  vec3 s = src.rgb/max(src.a,1e-6);
  float effA = src.a*clamp(u_intensity,0.0,1.0);
  vec3 screened = 1.0 - (1.0-base.rgb)*(1.0-s);
  o = vec4(mix(base.rgb, screened, effA), base.a);
}`);

// ------------------------------------------- bloom · dual-filter (F5b, GL-only look)
// Jimenez/Kawase dual-filter chain: 13-tap downsample ×3 (W/2, W/4, W/8) then
// 9-tap tent upsample back, averaging in the same-size skip at each level
// (0.5·(up+skip) — the canonical additive form assumes HDR float targets; in
// this RGBA8 pipeline straight adds clamp to white, averaging keeps the
// hierarchy bounded). Hardware LINEAR at half-texel offsets is fine HERE
// because this whole mode is DIVERGENCE-ACCEPTED (user decision, Skia-blur
// precedent): the CPU op maps quality:"dual" to its gaussian pipeline at an
// equivalent visual radius — GL is the look authority for this mode, still
// export renders the gaussian look. Parity entry is stats-only.
// u_srcTexel = 1/srcDims (the texture being READ — u_texel describes the dst).
const BLOOM_DOWN13_FRAG = f(`uniform vec2 u_srcTexel;
void main(){
  vec2 t = u_srcTexel;
  vec4 A = texture(u_tex, v_uv + t*vec2(-2.0,-2.0));
  vec4 B = texture(u_tex, v_uv + t*vec2( 0.0,-2.0));
  vec4 C = texture(u_tex, v_uv + t*vec2( 2.0,-2.0));
  vec4 D = texture(u_tex, v_uv + t*vec2(-2.0, 0.0));
  vec4 E = texture(u_tex, v_uv);
  vec4 F = texture(u_tex, v_uv + t*vec2( 2.0, 0.0));
  vec4 G = texture(u_tex, v_uv + t*vec2(-2.0, 2.0));
  vec4 H = texture(u_tex, v_uv + t*vec2( 0.0, 2.0));
  vec4 I = texture(u_tex, v_uv + t*vec2( 2.0, 2.0));
  vec4 J = texture(u_tex, v_uv + t*vec2(-1.0,-1.0));
  vec4 K = texture(u_tex, v_uv + t*vec2( 1.0,-1.0));
  vec4 L = texture(u_tex, v_uv + t*vec2(-1.0, 1.0));
  vec4 M = texture(u_tex, v_uv + t*vec2( 1.0, 1.0));
  o = E*0.125 + (A+C+G+I)*0.03125 + (B+D+F+H)*0.0625 + (J+K+L+M)*0.125;
}`);

const BLOOM_UPTENT_FRAG = f(`uniform vec2 u_srcTexel;
uniform float u_off;
uniform sampler2D u_skip;
uniform float u_hasSkip;
void main(){
  vec2 t = u_srcTexel * u_off;
  vec4 up = ( texture(u_tex, v_uv + vec2(-t.x,-t.y)) + 2.0*texture(u_tex, v_uv + vec2(0.0,-t.y)) + texture(u_tex, v_uv + vec2(t.x,-t.y))
        + 2.0*texture(u_tex, v_uv + vec2(-t.x, 0.0)) + 4.0*texture(u_tex, v_uv)               + 2.0*texture(u_tex, v_uv + vec2(t.x, 0.0))
        +     texture(u_tex, v_uv + vec2(-t.x, t.y)) + 2.0*texture(u_tex, v_uv + vec2(0.0, t.y)) + texture(u_tex, v_uv + vec2(t.x, t.y)) ) / 16.0;
  o = u_hasSkip>0.5 ? (up + texture(u_skip, v_uv))*0.5 : up;
}`);

function runBloomDual(
  ctx: MultiPassCtx,
  intensity: number,
  thr255: number,
  radius: number,
  dims: { w: number; h: number },
) {
  if (intensity <= 0) {
    ctx.run(COPY_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }]);
    return;
  }
  const W = dims.w;
  const H = dims.h;
  const w2 = Math.max(1, Math.round(W / 2));
  const h2 = Math.max(1, Math.round(H / 2));
  const w4 = Math.max(1, Math.round(W / 4));
  const h4 = Math.max(1, Math.round(H / 4));
  const w8 = Math.max(1, Math.round(W / 8));
  const h8 = Math.max(1, Math.round(H / 8));
  // tent spread: radius 12 (default) ≈ 1 texel at each level's own scale
  const off = Math.min(3, Math.max(0.5, radius / 12));

  const bright = ctx.temp("bright");
  ctx.run(BLOOM_BRIGHT_FRAG, bright, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
    gl.uniform1f(loc(gl, prog, "u_thr255"), thr255);
  });
  const srcTexel = (w: number, h: number) => (gl: WebGL2RenderingContext, prog: WebGLProgram) => {
    gl.uniform2f(loc(gl, prog, "u_srcTexel"), 1 / w, 1 / h);
  };
  const d1 = ctx.temp("dualD1", w2, h2);
  const d2 = ctx.temp("dualD2", w4, h4);
  const d3 = ctx.temp("dualD3", w8, h8);
  ctx.run(BLOOM_DOWN13_FRAG, d1, [{ name: "u_tex", tex: bright.tex }], srcTexel(W, H));
  ctx.run(BLOOM_DOWN13_FRAG, d2, [{ name: "u_tex", tex: d1.tex }], srcTexel(w2, h2));
  ctx.run(BLOOM_DOWN13_FRAG, d3, [{ name: "u_tex", tex: d2.tex }], srcTexel(w4, h4));
  const upStep = (
    dst: { tex: WebGLTexture },
    src: { tex: WebGLTexture },
    skip: { tex: WebGLTexture } | null,
    sw: number,
    sh: number,
  ) => {
    ctx.run(
      BLOOM_UPTENT_FRAG,
      dst,
      [
        { name: "u_tex", tex: src.tex },
        { name: "u_skip", tex: (skip ?? src).tex },
      ],
      (gl, prog) => {
        gl.uniform2f(loc(gl, prog, "u_srcTexel"), 1 / sw, 1 / sh);
        gl.uniform1f(loc(gl, prog, "u_off"), off);
        gl.uniform1f(loc(gl, prog, "u_hasSkip"), skip ? 1 : 0);
      },
    );
  };
  const u2 = ctx.temp("dualU2", w4, h4);
  const u1 = ctx.temp("dualU1", w2, h2);
  const full = ctx.temp("dualFull");
  upStep(u2, d3, d2, w8, h8);
  upStep(u1, u2, d1, w4, h4);
  upStep(full, u1, null, w2, h2);
  ctx.run(
    BLOOM_COMPOSITE_FRAG,
    ctx.output,
    [
      { name: "u_tex", tex: ctx.input.tex },
      { name: "u_blurred", tex: full.tex },
    ],
    (gl, prog) => {
      gl.uniform1f(loc(gl, prog, "u_intensity"), intensity);
    },
  );
}

const BLOOM_FRAGS = [COPY_FRAG, BLOOM_BRIGHT_FRAG, BLOOM_GAUSS_FRAG, BLOOM_COMPOSITE_FRAG, BLOOM_DOWN13_FRAG, BLOOM_UPTENT_FRAG];

function runBloomChain(ctx: MultiPassCtx, intensity: number, thr255: number, radius: number) {
  if (intensity <= 0) {
    ctx.run(COPY_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }]);
    return;
  }
  const bright = ctx.temp("bright");
  ctx.run(BLOOM_BRIGHT_FRAG, bright, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
    gl.uniform1f(loc(gl, prog, "u_thr255"), thr255);
  });
  const { taps, step } = gaussTaps(radius);
  const blurH = ctx.temp("blurH");
  const blurV = ctx.temp("blurV");
  const setGauss = (horiz: boolean) => (gl: WebGL2RenderingContext, prog: WebGLProgram) => {
    gl.uniform1f(loc(gl, prog, "u_sigma"), radius);
    gl.uniform1i(loc(gl, prog, "u_taps"), taps);
    gl.uniform1f(loc(gl, prog, "u_step"), step);
    gl.uniform1f(loc(gl, prog, "u_horiz"), horiz ? 1 : 0);
  };
  ctx.run(BLOOM_GAUSS_FRAG, blurH, [{ name: "u_tex", tex: bright.tex }], setGauss(true));
  ctx.run(BLOOM_GAUSS_FRAG, blurV, [{ name: "u_tex", tex: blurH.tex }], setGauss(false));
  ctx.run(
    BLOOM_COMPOSITE_FRAG,
    ctx.output,
    [
      { name: "u_tex", tex: ctx.input.tex },
      { name: "u_blurred", tex: blurV.tex },
    ],
    (gl, prog) => {
      gl.uniform1f(loc(gl, prog, "u_intensity"), intensity);
    },
  );
}

export const bloom: GpuPass = {
  frags: BLOOM_FRAGS,
  multi: (ctx, p, u, _t, dims) => {
    const intensity = pn(p, "intensity", 0.5);
    const thr255 = pn(p, "threshold", 0.7) * 255;
    const radius = Math.max(0.5, pn(p, "radius", 12) * u);
    if (ps(p, "quality", "gaussian") === "dual") {
      runBloomDual(ctx, intensity, thr255, radius, dims);
      return;
    }
    runBloomChain(ctx, intensity, thr255, radius);
  },
};

export const characterBloom: GpuPass = {
  frags: BLOOM_FRAGS,
  multi: (ctx, p, u) => {
    const intensity = pn(p, "intensity", 0.7);
    const thr255 = pn(p, "threshold", 0.55) * 255;
    const radius = Math.max(0.5, pn(p, "radius", 6) * u);
    runBloomChain(ctx, intensity, thr255, radius);
  },
};
