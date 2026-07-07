// BG Lab GL passes — kuwahara (fast/smooth + anisotropic). Moved verbatim
// from shaders.ts.

import type { ParamValue } from "../../../types";
import { pn, ps } from "../../cpu/util";
import { type GpuPass, type MultiPassCtx, f, loc } from "../common";

// ---------------------------------------------------------------- kuwahara
// Mirrors cpu/converters.ts `kuwahara` exactly (both quality modes in one
// shader, uniform-branched — see u_smooth). Radius is hard-capped at
// R_MAX=12 on the CPU side (setUniforms) before it ever reaches the shader;
// R_MAX doubles as the constant loop bound GLSL needs to unroll the box scan.
// Runtime radii below 12 are handled by an early `continue` per sample — the
// loop still iterates the full (2*R_MAX+1)^2 box, but skipped samples cost no
// texture read, which is where the quadratic blowup actually lives.
// Sampling is pixel-space + CLAMP_TO_EDGE via idx clamp (same pattern as
// crtCurvature/grain above), matching the CPU's clamp(x+dx,0,W-1) exactly.
// fast: 4 overlapping quadrant sectors accumulated via explicit vec3 sums
// (no dynamic array indexing needed — only 4 fixed sectors, if-chains).
// smooth: 8 angular sectors over the disc, accumulated into local arrays
// indexed by a loop-computed int — standard and portable in GLSL ES 3.00
// fragment shaders (core WebGL2, no extension).
// Both modes share the single box loop and the texture read per sample;
// only the accumulation differs, branched on u_smooth.
const KUWAHARA_FRAG = f(`const int R_MAX = 12;
uniform int u_radius;   // 2..12 runtime
uniform int u_smooth;   // 0 fast, 1 smooth
// Octant of integer offset (x,y) == the CPU's min(7, floor(atan2(y,x)/45deg))
// for every disc offset at R<=12 (verified exhaustively against f64). Integer
// comparisons instead of atan: GPU atan is approximate, and disc offsets land
// EXACTLY on the 45deg sector boundaries (axes + diagonals, ~22% of samples),
// where a few-ULP atan error reassigns the sample to the neighbouring sector.
int sectorOf(int x, int y){
  if(y==0) return x>=0?0:4;
  if(y>0){ if(x>0&&y<x)return 0; if(x>0)return 1; if(x==0)return 2; if(-x<y)return 2; return 3; }
  if(x<0&&-y<-x)return 4; if(x<0)return 5; if(x==0)return 6; if(x<-y)return 6; return 7;
}
void main(){
  // Integer pixel coords, top-left origin — CPU x,y. floor() is load-bearing:
  // v_uv sits at pixel CENTRES, so without it idx lands on texel boundaries
  // and LINEAR filtering blends two texels instead of reading one exactly.
  vec2 px = floor(vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y));

  // f32-exact statistics, matching the CPU's f64-on-integers to ~1e-7:
  // (1) snap texels to exact 8-bit integers — v/255 is INEXACT in f32, and
  //     that per-sample noise (~0.065 variance units at 255-scale) flips
  //     near-tied sector picks across whole flat regions;
  // (2) accumulate deviations from the centre pixel — integer deviations and
  //     their squares stay < 2^24, so sums are EXACT in f32, and the
  //     var = q/n - m*m cancellation never amplifies (both terms sit at the
  //     variance's own magnitude). Variance is shift-invariant, mean = m'+c00.
  vec3 c00 = floor(texture(u_tex, vec2((px.x+0.5)/u_dims.x, 1.0-(px.y+0.5)/u_dims.y)).rgb*255.0+0.5);

  // fast-mode accumulators: s0=(-x,-y) s1=(+x,-y) s2=(-x,+y) s3=(+x,+y),
  // matching CPU sectorStats(-R,0,-R,0) / (0,R,-R,0) / (-R,0,0,R) / (0,R,0,R).
  vec3 s0=vec3(0.0), s1=vec3(0.0), s2=vec3(0.0), s3=vec3(0.0);
  vec3 q0=vec3(0.0), q1=vec3(0.0), q2=vec3(0.0), q3=vec3(0.0); // sum of squares
  float n0=0.0, n1=0.0, n2=0.0, n3=0.0;

  // smooth-mode accumulators: 8 angular sectors over the disc.
  vec3 ss[8]; vec3 sq[8]; float sn[8];
  for(int i=0;i<8;i++){ ss[i]=vec3(0.0); sq[i]=vec3(0.0); sn[i]=0.0; }

  for(int dy=-R_MAX; dy<=R_MAX; dy++){
    for(int dx=-R_MAX; dx<=R_MAX; dx++){
      if(abs(dx)>u_radius || abs(dy)>u_radius) continue;
      float fx=float(dx), fy=float(dy);

      if(u_smooth==0){
        // fast: |dx|<=r,|dy|<=r box already guaranteed by the skip above.
        bool inLeft  = dx<=0;
        bool inRight = dx>=0;
        bool inTop   = dy<=0;
        bool inBot   = dy>=0;
        vec2 idx = clamp(px+vec2(fx,fy), vec2(0.0), u_dims-1.0);
        vec3 c = floor(texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0-(idx.y+0.5)/u_dims.y)).rgb*255.0+0.5) - c00;
        if(inLeft && inTop)  { s0+=c; q0+=c*c; n0+=1.0; }
        if(inRight && inTop) { s1+=c; q1+=c*c; n1+=1.0; }
        if(inLeft && inBot)  { s2+=c; q2+=c*c; n2+=1.0; }
        if(inRight && inBot) { s3+=c; q3+=c*c; n3+=1.0; }
      } else {
        if(dx*dx+dy*dy > u_radius*u_radius) continue;
        int k = sectorOf(dx, dy);
        vec2 idx = clamp(px+vec2(fx,fy), vec2(0.0), u_dims-1.0);
        vec3 c = floor(texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0-(idx.y+0.5)/u_dims.y)).rgb*255.0+0.5) - c00;
        for(int i=0;i<8;i++){
          if(i==k){ ss[i]+=c; sq[i]+=c*c; sn[i]+=1.0; }
        }
      }
    }
  }

  // Means are centre-relative (see c00 above): output = best + c00.
  vec3 best; float bestVar;
  if(u_smooth==0){
    vec3 m0=s0/max(n0,1.0), v0=q0/max(n0,1.0)-m0*m0;
    vec3 m1=s1/max(n1,1.0), v1=q1/max(n1,1.0)-m1*m1;
    vec3 m2=s2/max(n2,1.0), v2=q2/max(n2,1.0)-m2*m2;
    vec3 m3=s3/max(n3,1.0), v3=q3/max(n3,1.0)-m3*m3;
    vec3 wl = vec3(0.299,0.587,0.114);
    float var0=dot(v0,wl), var1=dot(v1,wl), var2=dot(v2,wl), var3=dot(v3,wl);
    best=m0; bestVar=var0;
    if(var1<bestVar){ best=m1; bestVar=var1; }
    if(var2<bestVar){ best=m2; bestVar=var2; }
    if(var3<bestVar){ best=m3; bestVar=var3; }
  } else {
    best=vec3(0.0); bestVar=3.4e38;
    vec3 wl = vec3(0.299,0.587,0.114);
    for(int k=0;k<8;k++){
      if(sn[k]<1.0) continue;
      vec3 m = ss[k]/sn[k];
      vec3 v = sq[k]/sn[k] - m*m;
      float variance = dot(v, wl);
      if(variance<bestVar){ bestVar=variance; best=m; }
    }
  }
  o = vec4(clamp((best + c00)/255.0, 0.0, 1.0), 1.0);
}`);

// ------------------------------------------- kuwahara · anisotropic (Kyprianidis)
// Mirrors cpu/converters.ts `kuwaharaAniso` — ONE spec, both engines:
//   1. structure tensor from Sobel on luma601 of 8-bit-snapped texels
//      (E=gx²/16, G=gy²/16, F=gx·gy/16 — the /16 normalization cancels in the
//      eigen math and keeps values packable in [0,1])
//   2. 9×9 gaussian tensor smooth (σ=2), idx-clamped
//   3. oriented Papari filter: ellipse major axis along the local tangent
//      (φ = 0.5·atan2(2F, E−G) + π/2 — CONTINUOUS use only, feeds a rotation,
//      never a discrete pick, so f32 atan error stays sub-visible), axes
//      a = R·clamp((α+A)/α, 1, 2), b = R·clamp(α/(α+A), 0.5, 1); smooth
//      polynomial sector weights cos^8(θv−kπ/4)·exp(−3.125|v|²) computed via
//      dot products with the 8 sector unit dirs — NO discrete sector
//      assignment, so the integer-sectorOf fix above isn't needed here
//   4. sector blend α_k = 1/(1 + σ_k^q), σ in byte scale, q = sharpness/2
// Tensor temps are 16-bit packed (pack16/unpack16, XDoG precedent): F is
// signed and the eigen decomposition subtracts near-equal quantities — raw
// 8-bit tensor storage gives visible stroke-direction banding in flat regions.
// F is duplicated into rg AND ba so ONE smooth frag serves both tensor temps.
// Aniso radius caps at 8 (ellipse extends to 2R = 16 = R_MAX_A loop bound).
// Parity tier: statistical (tensor smoothing + trig divergence), targets in
// ParityClient — NOT bit-exact like fast/smooth.
const KW_ANISO_TENSOR_EG = f(`
float texelLuma(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  vec3 rgb = floor(texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y)).rgb*255.0+0.5);
  return luma601(rgb)/255.0;
}
vec2 pack16(float v){ float e = clamp(v,0.0,1.0)*255.0; float hi = floor(e); return vec2(hi/255.0, e-hi); }
void main(){
  vec2 px = floor(vec2(v_uv.x*u_dims.x,(1.0-v_uv.y)*u_dims.y));
  float tl=texelLuma(px+vec2(-1.0,-1.0)), tc=texelLuma(px+vec2(0.0,-1.0)), tr=texelLuma(px+vec2(1.0,-1.0));
  float ml=texelLuma(px+vec2(-1.0,0.0)),                                   mr=texelLuma(px+vec2(1.0,0.0));
  float bl=texelLuma(px+vec2(-1.0,1.0)), bc=texelLuma(px+vec2(0.0,1.0)), br=texelLuma(px+vec2(1.0,1.0));
  float gx = (tr+2.0*mr+br) - (tl+2.0*ml+bl);
  float gy = (bl+2.0*bc+br) - (tl+2.0*tc+tr);
  o = vec4(pack16(gx*gx/16.0), pack16(gy*gy/16.0));
}`);

const KW_ANISO_TENSOR_F = f(`
float texelLuma(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  vec3 rgb = floor(texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y)).rgb*255.0+0.5);
  return luma601(rgb)/255.0;
}
vec2 pack16(float v){ float e = clamp(v,0.0,1.0)*255.0; float hi = floor(e); return vec2(hi/255.0, e-hi); }
void main(){
  vec2 px = floor(vec2(v_uv.x*u_dims.x,(1.0-v_uv.y)*u_dims.y));
  float tl=texelLuma(px+vec2(-1.0,-1.0)), tc=texelLuma(px+vec2(0.0,-1.0)), tr=texelLuma(px+vec2(1.0,-1.0));
  float ml=texelLuma(px+vec2(-1.0,0.0)),                                   mr=texelLuma(px+vec2(1.0,0.0));
  float bl=texelLuma(px+vec2(-1.0,1.0)), bc=texelLuma(px+vec2(0.0,1.0)), br=texelLuma(px+vec2(1.0,1.0));
  float gx = (tr+2.0*mr+br) - (tl+2.0*ml+bl);
  float gy = (bl+2.0*bc+br) - (tl+2.0*tc+tr);
  vec2 fp = pack16((gx*gy+16.0)/32.0); // signed → [0,1]; duplicated so the smooth frag is shared
  o = vec4(fp, fp);
}`);

const KW_ANISO_SMOOTH = f(`
float unpack16(vec2 hl){ return hl.x + hl.y/255.0; }
vec2 pack16(float v){ float e = clamp(v,0.0,1.0)*255.0; float hi = floor(e); return vec2(hi/255.0, e-hi); }
vec4 texelRGBA(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  return texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y));
}
void main(){
  vec2 px = floor(vec2(v_uv.x*u_dims.x,(1.0-v_uv.y)*u_dims.y));
  float a0=0.0; float a1=0.0; float wsum=0.0;
  for(int j=-4;j<=4;j++){
    for(int i=-4;i<=4;i++){
      float w = exp(-float(i*i+j*j)/8.0); // σ=2
      vec4 t = texelRGBA(px+vec2(float(i),float(j)));
      a0 += unpack16(t.rg)*w;
      a1 += unpack16(t.ba)*w;
      wsum += w;
    }
  }
  o = vec4(pack16(a0/wsum), pack16(a1/wsum));
}`);

const KW_ANISO_MAIN = f(`const int R_MAX_A = 16;
uniform int u_radius;
uniform float u_alpha;
uniform float u_q;
uniform sampler2D u_teg;
uniform sampler2D u_tf;
const vec2 SECT[8] = vec2[8](
  vec2(1.0,0.0), vec2(0.7071067811865476,0.7071067811865476),
  vec2(0.0,1.0), vec2(-0.7071067811865476,0.7071067811865476),
  vec2(-1.0,0.0), vec2(-0.7071067811865476,-0.7071067811865476),
  vec2(0.0,-1.0), vec2(0.7071067811865476,-0.7071067811865476));
float unpack16(vec2 hl){ return hl.x + hl.y/255.0; }
vec4 texelOf(sampler2D s, vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  return texture(s, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y));
}
void main(){
  vec2 px = floor(vec2(v_uv.x*u_dims.x,(1.0-v_uv.y)*u_dims.y));
  vec3 c00 = floor(texelOf(u_tex, px).rgb*255.0+0.5);
  vec4 teg = texelOf(u_teg, px);
  float E = unpack16(teg.rg);
  float G = unpack16(teg.ba);
  float F = unpack16(texelOf(u_tf, px).rg)*2.0 - 1.0;
  float diff = E - G;
  float rad = sqrt(diff*diff + 4.0*F*F);
  float lam1 = (E+G+rad)*0.5;
  float lam2 = (E+G-rad)*0.5;
  float A = (lam1-lam2)/(lam1+lam2+1e-7);
  float phi = 0.5*atan(2.0*F, diff) + 1.5707963267948966; // major axis = local tangent
  float R = float(u_radius);
  float a = R*clamp((u_alpha+A)/u_alpha, 1.0, 2.0);
  float b = R*clamp(u_alpha/(u_alpha+A), 0.5, 1.0);
  float ca = cos(phi);
  float sa = sin(phi);
  vec3 m[8]; vec3 s[8]; float n[8];
  for(int k=0;k<8;k++){ m[k]=vec3(0.0); s[k]=vec3(0.0); n[k]=0.0; }
  int ext = int(ceil(a));
  for(int dy=-R_MAX_A; dy<=R_MAX_A; dy++){
    for(int dx=-R_MAX_A; dx<=R_MAX_A; dx++){
      if(abs(dx)>ext || abs(dy)>ext) continue;
      float fx=float(dx); float fy=float(dy);
      float ux = ( ca*fx + sa*fy)/a;
      float uy = (-sa*fx + ca*fy)/b;
      float vv = ux*ux + uy*uy;
      if(vv > 1.0) continue;
      vec3 c = floor(texelOf(u_tex, px+vec2(fx,fy)).rgb*255.0+0.5) - c00;
      float ew = exp(-3.125*vv);
      float vl = sqrt(vv);
      vec2 vn = vl>1e-6 ? vec2(ux,uy)/vl : vec2(0.0);
      for(int k=0;k<8;k++){
        float ck;
        if(vl>1e-6){
          ck = max(0.0, dot(vn, SECT[k]));
          ck = ck*ck; ck = ck*ck; ck = ck*ck; // cos^8
        } else {
          ck = 0.125; // centre pixel: split evenly across sectors
        }
        float w = ck*ew;
        m[k] += c*w;
        s[k] += c*c*w;
        n[k] += w;
      }
    }
  }
  vec3 accM = vec3(0.0);
  float accW = 0.0;
  vec3 wl = vec3(0.299,0.587,0.114);
  for(int k=0;k<8;k++){
    if(n[k]<1e-6) continue;
    vec3 mk = m[k]/n[k];
    vec3 vk = s[k]/n[k] - mk*mk;
    float sig = sqrt(max(0.0, dot(vk, wl))); // byte scale
    float ak = 1.0/(1.0 + pow(sig, u_q));
    accM += mk*ak;
    accW += ak;
  }
  vec3 best = accW>0.0 ? accM/accW : vec3(0.0);
  o = vec4(clamp((best + c00)/255.0, 0.0, 1.0), 1.0);
}`);

function runKuwaharaAniso(ctx: MultiPassCtx, p: Record<string, ParamValue>, u: number) {
  const R = Math.min(8, Math.max(2, Math.round(pn(p, "radius", 4) * u)));
  // slider is "stroke elongation" (higher = longer strokes); Kyprianidis α is
  // its inverse. Same mapping in the CPU mirror.
  const alpha = 1 / Math.min(2, Math.max(0.25, pn(p, "anisotropy", 1)));
  const q = Math.min(16, Math.max(2, pn(p, "sharpness", 8))) * 0.5;
  const teg = ctx.temp("kwTensorEG");
  const tf = ctx.temp("kwTensorF");
  const tegS = ctx.temp("kwTensorEGs");
  const tfS = ctx.temp("kwTensorFs");
  ctx.run(KW_ANISO_TENSOR_EG, teg, [{ name: "u_tex", tex: ctx.input.tex }]);
  ctx.run(KW_ANISO_TENSOR_F, tf, [{ name: "u_tex", tex: ctx.input.tex }]);
  ctx.run(KW_ANISO_SMOOTH, tegS, [{ name: "u_tex", tex: teg.tex }]);
  ctx.run(KW_ANISO_SMOOTH, tfS, [{ name: "u_tex", tex: tf.tex }]);
  ctx.run(
    KW_ANISO_MAIN,
    ctx.output,
    [
      { name: "u_tex", tex: ctx.input.tex },
      { name: "u_teg", tex: tegS.tex },
      { name: "u_tf", tex: tfS.tex },
    ],
    (gl, prog) => {
      gl.uniform1i(loc(gl, prog, "u_radius"), R);
      gl.uniform1f(loc(gl, prog, "u_alpha"), alpha);
      gl.uniform1f(loc(gl, prog, "u_q"), q);
    },
  );
}

export const kuwahara: GpuPass = {
  frags: [KUWAHARA_FRAG, KW_ANISO_TENSOR_EG, KW_ANISO_TENSOR_F, KW_ANISO_SMOOTH, KW_ANISO_MAIN],
  multi: (ctx, p, u) => {
    if (ps(p, "quality", "fast") === "anisotropic") {
      runKuwaharaAniso(ctx, p, u);
      return;
    }
    // classic fast/smooth: the original single-pass frag verbatim — one step,
    // same uniforms — so old configs stay byte-identical through the multi path.
    ctx.run(KUWAHARA_FRAG, ctx.output, [{ name: "u_tex", tex: ctx.input.tex }], (gl, prog) => {
      const radius = Math.min(12, Math.max(2, Math.round(pn(p, "radius", 4) * u)));
      gl.uniform1i(loc(gl, prog, "u_radius"), radius);
      gl.uniform1i(loc(gl, prog, "u_smooth"), ps(p, "quality", "fast") === "smooth" ? 1 : 0);
    });
  },
};
