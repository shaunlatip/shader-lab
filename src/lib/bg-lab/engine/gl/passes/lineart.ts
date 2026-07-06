// BG Lab GL passes — lineArt (classic outline/hatch/ink + XDoG). Moved
// verbatim from shaders.ts.

import type { ParamValue } from "../../../types";
import { pn, ps } from "../../cpu/util";
import { type GpuPass, type MultiPassCtx, col, f, loc } from "../common";

// ---------------------------------------------------------------- lineArt
// Mirrors cpu/converters.ts `lineArt` exactly for wiggle=0 (the default):
// same integer-pixel lumaAt/sobelMag/dilation/hatch math, same NEAREST texel
// sampling via idx clamp (the crtCurvature/kuwahara pattern). For wiggle>0 the
// ALGORITHM is replicated (same sin-hash formula, same offset math) but GPU
// f32 sin/hash does not bit-match JS f64 Math.sin — wiggle is stochastic
// styling, not a parity target, so that divergence is accepted (documented
// here rather than chased).
// Thickness is pre-clamped CPU-side to [1,40] (matching the CPU op) and the
// dilation radius r=ceil(thickness-1) is computed CPU-side and capped at
// T_MAX=12 (thickness slider max is 4 units; typical unit <=3 → r<=9, well
// under the cap) — T_MAX doubles as the constant loop bound GLSL needs, same
// R_MAX-cap pattern as kuwahara above. Skip guards (|dx|>r||dy>r) run before
// any texture read, so runtime cost tracks r^2 * 8 lumaAt reads, not T_MAX^2.
// The CPU's dilation loop takes max(mag, sobelMag at every offset INCLUDING
// (0,0) implicitly re-checked) — including the centre offset here is
// equivalent (mag is already seeded from it) and keeps the loop body branch-free.
// mode==="xdog" runs a completely separate 2-pass channel-packed pipeline
// (see LINEART_XDOG_PASS1/2 below); modes outline/hatch/ink run the ORIGINAL
// single frag below, unchanged, as one ctx.run step (byte-identical output).
const LINEART_FRAG = f(`const int T_MAX = 12;
uniform int u_mode;        // 0 outline, 1 hatch, 2 ink
uniform float u_thickness; // pre-clamped [1,40] CPU-side
uniform float u_threshold; // [0,1]
uniform float u_wiggle;    // [0,1]
uniform float u_hatchSpacing; // px, unit-scaled CPU-side, >=2
uniform int u_dilate;      // r = ceil(thickness-1), capped [0,T_MAX] CPU-side
uniform vec3 u_ink;
uniform vec3 u_paper;

float hash2(vec2 p){ float s=sin(p.x*12.9898+p.y*78.233)*43758.5453; return s-floor(s); }

// NEAREST texel fetch by integer pixel coords (top-left origin), CLAMP_TO_EDGE
// via idx clamp — same pattern as crtCurvature/kuwahara.
vec3 texelAt(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  return texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y)).rgb;
}

// Matches CPU lumaAt: wiggle offsets the sample coords via a 4x4-cell hash,
// then rounds (floor(x+0.5)) + clamps to integer texel indices.
float lumaAt(vec2 p){
  vec2 s = p;
  if(u_wiggle>0.0){
    float h = hash2(floor(p/4.0));
    float freq = 0.08;
    s.x += sin(p.y*freq)*h*u_wiggle*8.0;
    s.y += cos(p.x*freq)*h*u_wiggle*8.0;
  }
  vec2 idx = clamp(floor(s+0.5), vec2(0.0), u_dims-1.0);
  return luma601(texelAt(idx));
}

// Sobel on luma: Sx=[[-1,0,1],[-2,0,2],[-1,0,1]], Sy = Sx^T. 8 lumaAt calls,
// centre skipped (matches CPU sobelMag's l(dx,dy) closure).
float sobelMag(vec2 p){
  float lTL=lumaAt(p+vec2(-1.0,-1.0)), lT=lumaAt(p+vec2(0.0,-1.0)), lTR=lumaAt(p+vec2(1.0,-1.0));
  float lL =lumaAt(p+vec2(-1.0, 0.0)),                              lR =lumaAt(p+vec2(1.0, 0.0));
  float lBL=lumaAt(p+vec2(-1.0, 1.0)), lB=lumaAt(p+vec2(0.0, 1.0)), lBR=lumaAt(p+vec2(1.0, 1.0));
  float gx = -lTL + lTR - 2.0*lL + 2.0*lR - lBL + lBR;
  float gy = -lTL - 2.0*lT - lTR + lBL + 2.0*lB + lBR;
  return sqrt(gx*gx+gy*gy);
}

// Matches CPU isHatch: integer px,py as floats, float mod() == JS % for
// positive operands. s=hatchSpacing.
bool isHatch(vec2 p, float lum){
  float s = u_hatchSpacing;
  if(lum<=0.45 && mod(p.y,s)<=1.0) return true;   // horizontal, darkest
  if(lum<=0.55 && mod(p.x,s)<=1.0) return true;   // vertical
  if(lum<=0.65 && mod(p.x+p.y,s)<=1.0) return true; // diagonal
  return false;
}

void main(){
  // Integer pixel coords, top-left origin — CPU x,y. floor() is load-bearing
  // (v_uv sits at pixel centres — see kuwahara comment above for why).
  vec2 px = floor(vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y));
  float lum = lumaAt(px);
  bool isInk = false;

  if(u_mode==0 || u_mode==2){
    float mag = sobelMag(px);
    float edgeMag = mag;
    if(u_thickness>1.0){
      int r = u_dilate;
      for(int dy=-T_MAX; dy<=T_MAX; dy++){
        for(int dx=-T_MAX; dx<=T_MAX; dx++){
          if(abs(dx)>r || abs(dy)>r) continue;
          edgeMag = max(edgeMag, sobelMag(px+vec2(float(dx),float(dy))));
        }
      }
    }
    if(edgeMag>u_threshold) isInk = true;
  }

  if(u_mode==1 || u_mode==2){
    if(isHatch(px, lum)) isInk = true;
  }

  o = vec4(isInk ? u_ink : u_paper, 1.0);
}`);

function runLineArtClassic(ctx: MultiPassCtx, p: Record<string, ParamValue>, u: number) {
  ctx.run(LINEART_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
    const modes: Record<string, number> = { outline: 0, hatch: 1, ink: 2 };
    gl.uniform1i(loc(gl, prog, "u_mode"), modes[ps(p, "mode", "outline")] ?? 0);
    // CPU clamps thickness to [1,40]; GL additionally caps at 13 so
    // r=ceil(thickness-1) never exceeds T_MAX=12 (the loop's constant bound).
    // Slider max is 4 units at unit<=~3 -> thickness<=12, well under the cap,
    // so this only bites on extreme resolution-scale inputs.
    const thickness = Math.min(13, Math.max(1, pn(p, "thickness", 1.5) * u));
    gl.uniform1f(loc(gl, prog, "u_thickness"), thickness);
    gl.uniform1f(loc(gl, prog, "u_threshold"), Math.min(1, Math.max(0, pn(p, "threshold", 0.5))));
    gl.uniform1f(loc(gl, prog, "u_wiggle"), Math.min(1, Math.max(0, pn(p, "wiggle", 0))));
    // Integer px, in lockstep with the CPU op (fractional s makes y%s
    // f32/f64-divergent — whole hatch bands flip between engines).
    gl.uniform1f(loc(gl, prog, "u_hatchSpacing"), Math.max(2, Math.round(pn(p, "hatchSpacing", 8) * u)));
    const r = thickness > 1 ? Math.min(12, Math.ceil(thickness - 1)) : 0;
    gl.uniform1i(loc(gl, prog, "u_dilate"), r);
    gl.uniform3fv(loc(gl, prog, "u_ink"), col(p, "ink", "#16140f"));
    gl.uniform3fv(loc(gl, prog, "u_paper"), col(p, "paper", "#f1ece4"));
  });
}

// ---------------------------------------------------------------- lineArt · XDoG
// Winnemöller XDoG (the SHARPENED form) on luma601, mirroring
// cpu/converters.ts `lineArtXdog` exactly:
//   S = (1+p)*G_sigma - p*G_{k*sigma}     (k=1.6, p=20 fixed sharpen weight)
//   E = 1 if S >= eps else 1 + tanh(phi*(S - eps));  color = mix(ink,paper,E)
// The plain D = G1 - 0.99*G2 form compresses flat regions to ~0.01*luma —
// everything lands below any usable eps and renders mid-grey mush. The
// sharpened form keeps S at luma scale (flat region: S = L), so eps acts as a
// tone threshold (bright -> paper, dark -> ink) with DoG edge emphasis on top
// — the canonical XDoG sketch look. eps = 0.2 + threshold*0.8.
// wiggle does NOT apply here (ignored) — xdog's own gaussians already soften
// strokes, so a stochastic sample-coord wiggle on top would just add noise.
//
// 2-pass pipeline (separable gaussian, H then V), 16-bit fixed-point packed:
// the F5a temp pool is RGBA8 (glContext texImage2D RGBA/UNSIGNED_BYTE), and
// the p=20 sharpen amplifies any intermediate quantization ~20x — raw 8-bit
// storage of the H-blurs would put ~0.16 of noise on S (vs eps range 0.2-1.0).
// So pass 1 stores G_sigma in (r,g) and G_{k*sigma} in (b,a) as hi/lo bytes
// (decoded error 1/65025 -> ~0.0003 on S — negligible).
// Pass 1 (input -> temp): H-blur luma at both sigmas, one shared tap loop
//   (R_MAX=48 constant bound, runtime skip), two weight accumulators.
// Pass 2 (temp -> output): V-blur each channel pair at its own sigma/radius,
//   then apply the XDoG formula.
const XDOG_R_MAX = 48;
const LINEART_XDOG_PASS1 = f(`const int R_MAX = 48;
uniform float u_sigma;
uniform int u_r0;   // ceil(3*sigma), capped R_MAX
uniform int u_r1;   // ceil(3*sigma*1.6), capped R_MAX

float texelLuma(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  vec3 rgb = texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y)).rgb;
  return luma601(rgb);
}
// 16-bit fixed point across two UNORM8 channels: hi = floor(v*255)/255 stores
// exactly; lo carries the fraction. Decode: hi + lo/255.
vec2 pack16(float v){ float e = clamp(v,0.0,1.0)*255.0; float hi = floor(e); return vec2(hi/255.0, e-hi); }

void main(){
  vec2 px = floor(vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y));
  float sigma0 = u_sigma;
  float sigma1 = u_sigma*1.6;
  float acc0 = 0.0, w0sum = 0.0;
  float acc1 = 0.0, w1sum = 0.0;
  for(int i=-R_MAX; i<=R_MAX; i++){
    float fi = float(i);
    float l = 0.0;
    bool need0 = abs(i) <= u_r0;
    bool need1 = abs(i) <= u_r1;
    if(!need0 && !need1) continue;
    l = texelLuma(px + vec2(fi, 0.0));
    if(need0){ float w = exp(-(fi*fi)/(2.0*sigma0*sigma0)); acc0 += l*w; w0sum += w; }
    if(need1){ float w = exp(-(fi*fi)/(2.0*sigma1*sigma1)); acc1 += l*w; w1sum += w; }
  }
  o = vec4(pack16(acc0/max(w0sum,1e-6)), pack16(acc1/max(w1sum,1e-6)));
}`);

const LINEART_XDOG_PASS2 = f(`const int R_MAX = 48;
uniform float u_sigma;
uniform int u_r0;
uniform int u_r1;
uniform float u_eps;
uniform float u_phi;
uniform vec3 u_ink;
uniform vec3 u_paper;

vec4 texelRGBA(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  return texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y));
}
float unpack16(vec2 hl){ return hl.x + hl.y/255.0; }

void main(){
  vec2 px = floor(vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y));
  float sigma0 = u_sigma;
  float sigma1 = u_sigma*1.6;
  float acc0 = 0.0, w0sum = 0.0;
  float acc1 = 0.0, w1sum = 0.0;
  for(int i=-R_MAX; i<=R_MAX; i++){
    float fi = float(i);
    bool need0 = abs(i) <= u_r0;
    bool need1 = abs(i) <= u_r1;
    if(!need0 && !need1) continue;
    vec4 t = texelRGBA(px + vec2(0.0, fi));
    if(need0){ float w = exp(-(fi*fi)/(2.0*sigma0*sigma0)); acc0 += unpack16(t.rg)*w; w0sum += w; }
    if(need1){ float w = exp(-(fi*fi)/(2.0*sigma1*sigma1)); acc1 += unpack16(t.ba)*w; w1sum += w; }
  }
  float gSigma = acc0/max(w0sum,1e-6);
  float gKSigma = acc1/max(w1sum,1e-6);
  float S = 21.0*gSigma - 20.0*gKSigma;  // (1+p)*G1 - p*G2, p=20
  float x = S >= u_eps ? 1.0 : 1.0 + tanh(u_phi*(S-u_eps));
  o = vec4(mix(u_ink, u_paper, x), 1.0);
}`);

function runLineArtXdog(ctx: MultiPassCtx, p: Record<string, ParamValue>, u: number) {
  const sigma = Math.min(8, Math.max(0.5, pn(p, "sigma", 2))) * u;
  const r0 = Math.min(XDOG_R_MAX, Math.ceil(3 * sigma));
  const r1 = Math.min(XDOG_R_MAX, Math.ceil(3 * sigma * 1.6));
  // threshold slider [0,1] default 0.5 is REUSED as the tone threshold via
  // eps = 0.2 + threshold*0.8 (default 0.5 -> eps 0.6, luma-scale — see the
  // sharpened-form comment above). Documented identically in the CPU op.
  const eps = 0.2 + Math.min(1, Math.max(0, pn(p, "threshold", 0.5))) * 0.8;
  const phi = Math.min(40, Math.max(1, pn(p, "edgeSoftness", 10)));
  const temp = ctx.temp("xdogBlur");
  ctx.run(LINEART_XDOG_PASS1, temp, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
    gl.uniform1f(loc(gl, prog, "u_sigma"), sigma);
    gl.uniform1i(loc(gl, prog, "u_r0"), r0);
    gl.uniform1i(loc(gl, prog, "u_r1"), r1);
  });
  ctx.run(LINEART_XDOG_PASS2, ctx.output, [{ name: "u_tex", tex: temp.tex }], (gl, prog) => {
    gl.uniform1f(loc(gl, prog, "u_sigma"), sigma);
    gl.uniform1i(loc(gl, prog, "u_r0"), r0);
    gl.uniform1i(loc(gl, prog, "u_r1"), r1);
    gl.uniform1f(loc(gl, prog, "u_eps"), eps);
    gl.uniform1f(loc(gl, prog, "u_phi"), phi);
    gl.uniform3fv(loc(gl, prog, "u_ink"), col(p, "ink", "#16140f"));
    gl.uniform3fv(loc(gl, prog, "u_paper"), col(p, "paper", "#f1ece4"));
  });
}

export const lineArt: GpuPass = {
  frags: [LINEART_FRAG, LINEART_XDOG_PASS1, LINEART_XDOG_PASS2],
  multi: (ctx, p, u) => {
    if (ps(p, "mode", "outline") === "xdog") {
      runLineArtXdog(ctx, p, u);
      return;
    }
    runLineArtClassic(ctx, p, u);
  },
};
