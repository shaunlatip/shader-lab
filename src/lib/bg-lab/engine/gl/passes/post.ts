// BG Lab GL passes — post family: scanlines, vignette, chromatic, displace,
// sharpen, pixelate, crtCurvature, grain, lightRays. Moved verbatim from
// shaders.ts.

import { hexRGB, pb, pixelateBlock, pn, ps } from "../../cpu/util";
import { type GpuPass, col, f, loc } from "../common";

// ---------------------------------------------------------------- scanlines / CRT lines
export const scanlines: GpuPass = {
  frag: f(`uniform float u_spacing; uniform float u_intensity; uniform float u_rgbCells;
void main(){ vec4 c=texture(u_tex,v_uv); float y=(1.0-v_uv.y)*u_dims.y; float x=v_uv.x*u_dims.x;
  float wave=(sin(y/u_spacing*6.2831853)*0.5+0.5)*u_intensity; float fac=1.0-wave; vec3 rgb=c.rgb*fac;
  if(u_rgbCells>0.5){ float cc=mod(floor(x),3.0); rgb.r*= cc==0.0?1.0:0.7; rgb.g*= cc==1.0?1.0:0.7; rgb.b*= cc==2.0?1.0:0.7; }
  o=vec4(rgb,c.a); }`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_spacing"), Math.max(1, pn(p, "spacing", 3) * u));
    gl.uniform1f(loc(gl, prog, "u_intensity"), pn(p, "intensity", 0.3));
    gl.uniform1f(loc(gl, prog, "u_rgbCells"), pb(p, "rgbCells", false) ? 1 : 0);
  },
};

// ---------------------------------------------------------------- vignette
export const vignette: GpuPass = {
  frag: f(`uniform float u_amount; uniform float u_radius; uniform float u_softness; uniform vec3 u_color;
void main(){ vec4 c=texture(u_tex,v_uv); vec2 d=(v_uv-0.5)*u_dims; float dist=length(d);
  float mx=length(u_dims)*0.5; float inner=u_radius*(1.0-u_softness)*mx; float outer=u_radius*mx+u_softness*mx;
  float a=u_amount*clamp((dist-inner)/max(1.0,outer-inner),0.0,1.0); o=vec4(mix(c.rgb,u_color,a),c.a); }`),
  setUniforms: (gl, prog, p) => {
    gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 0.4));
    gl.uniform1f(loc(gl, prog, "u_radius"), pn(p, "radius", 0.75));
    gl.uniform1f(loc(gl, prog, "u_softness"), pn(p, "softness", 0.45));
    gl.uniform3f(loc(gl, prog, "u_color"), ...col(p, "color", "#000000"));
  },
};

// ---------------------------------------------------------------- chromatic aberration / dispersion
// Mirrors cpu/ops.ts `chromatic` exactly: integer pixel coords (not pixel
// centres — see kuwahara/crtCurvature comments above for why floor() is
// load-bearing), NEAREST source sample via the idx-clamp pattern (CPU's
// clamp(Math.round(x),0,W-1)), and the same radial-dir ||1 guard, slide
// schedule, and luma-preserving saturation mix. amt<=0 is a CPU early return
// (no-op); mirrored here as a pass-through of the exact source texel.
// quality "high" (u_quality==1) runs the 6-wavelength (rygcbv) dispersion —
// same wavelength multipliers and pseudo-channel/reconstruction math as the
// CPU high-quality branch. N_MAX=16 constant loop bound (GLSL ES 3.00
// requires constant bounds); runtime sample count is a break, so no dynamic
// unrolling is needed — up to 16*6=96 texture reads in high mode.
export const chromatic: GpuPass = {
  frag: f(`const int N_MAX = 16;
uniform float u_amt; uniform float u_ax; uniform float u_ay; uniform float u_radial;
uniform int u_samples; uniform float u_sat; uniform int u_quality;
vec3 nearestTexel(vec2 samplePos){
  vec2 idx=clamp(floor(samplePos+0.5), vec2(0.0), u_dims-1.0);
  return texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0-(idx.y+0.5)/u_dims.y)).rgb;
}
void main(){
  vec2 px=floor(vec2(v_uv.x, 1.0-v_uv.y)*u_dims); // integer x,y (top-left origin), matches CPU loop
  vec3 srcTexel=nearestTexel(px);
  float srcAlpha=texture(u_tex,v_uv).a;
  if(u_amt<=0.0){ o=vec4(srcTexel,srcAlpha); return; }
  vec2 bdir=vec2(u_ax,u_ay); // unit direction for split/linear mode
  if(u_radial>0.5){
    vec2 d=px-u_dims*0.5;
    float len=length(d);
    bdir = len>0.0 ? d/len : d; // CPU: Math.hypot(dx,dy)||1 — at the exact centre pixel d is (0,0), dir stays (0,0)
  }
  vec3 acc=vec3(0.0);
  if(u_quality==1){
    // 6-wavelength (rygcbv): r=1.0 y=1.4 g=1.8 c=2.2 b=2.6 v=3.0
    float ra=0.0, ya=0.0, ga=0.0, ca=0.0, ba=0.0, va=0.0;
    for(int i=0;i<N_MAX;i++){
      if(i>=u_samples) break;
      float slide=(float(i)/float(u_samples))*0.1;
      float s=u_amt+slide;
      vec3 rgb;
      rgb=nearestTexel(px+bdir*s*1.0); ra+=rgb.r*0.5;
      rgb=nearestTexel(px+bdir*s*1.4); ya+=(2.0*rgb.r+2.0*rgb.g-rgb.b)/6.0;
      rgb=nearestTexel(px+bdir*s*1.8); ga+=rgb.g*0.5;
      rgb=nearestTexel(px+bdir*s*2.2); ca+=(2.0*rgb.g+2.0*rgb.b-rgb.r)/6.0;
      rgb=nearestTexel(px+bdir*s*2.6); ba+=rgb.b*0.5;
      rgb=nearestTexel(px+bdir*s*3.0); va+=(2.0*rgb.b+2.0*rgb.r-rgb.g)/6.0;
    }
    float n=float(u_samples);
    ra/=n; ya/=n; ga/=n; ca/=n; ba/=n; va/=n;
    acc.r = ra + (2.0*va + 2.0*ya - ca)/3.0;
    acc.g = ga + (2.0*ya + 2.0*ca - va)/3.0;
    acc.b = ba + (2.0*ca + 2.0*va - ya)/3.0;
  } else {
    // multi-sample dispersion: R×1 G×2 B×3 per-channel multipliers
    for(int i=0;i<N_MAX;i++){
      if(i>=u_samples) break;
      float slide=(float(i)/float(u_samples))*0.1;
      float s=(u_amt+slide);
      acc.r+=nearestTexel(px+bdir*s*1.0).r;
      acc.g+=nearestTexel(px+bdir*s*2.0).g;
      acc.b+=nearestTexel(px+bdir*s*3.0).b;
    }
    acc/=float(u_samples);
  }
  // saturation: mix(luma, rgb, u_sat) — luma-preserving; same formula as CPU
  float lum=luma601(acc);
  vec3 rgb=clamp(lum+(acc-vec3(lum))*u_sat, 0.0, 1.0);
  o=vec4(rgb,srcAlpha);
}`),
  setUniforms: (gl, prog, p, u) => {
    const mode = ps(p, "mode", "radial");
    const angle = ((mode === "split" ? 0 : pn(p, "angle", 0)) * Math.PI) / 180; // match CPU: split = horizontal
    gl.uniform1f(loc(gl, prog, "u_amt"), pn(p, "amount", 4) * u);
    gl.uniform1f(loc(gl, prog, "u_ax"), Math.cos(angle));
    gl.uniform1f(loc(gl, prog, "u_ay"), Math.sin(angle));
    gl.uniform1f(loc(gl, prog, "u_radial"), mode === "radial" ? 1 : 0);
    gl.uniform1i(loc(gl, prog, "u_samples"), Math.max(1, Math.round(pn(p, "samples", 1))));
    gl.uniform1f(loc(gl, prog, "u_sat"), pn(p, "saturation", 1));
    gl.uniform1i(loc(gl, prog, "u_quality"), ps(p, "quality", "normal") === "high" ? 1 : 0);
  },
};

// ---------------------------------------------------------------- displace / warp
export const displace: GpuPass = {
  frag: f(`uniform float u_amt; uniform float u_scale; uniform float u_sine;
float hash(vec2 p){ float s=sin(p.x*12.9898+p.y*78.233)*43758.5453; return fract(s); }
void main(){ vec2 px=v_uv*u_dims; float dx,dy;
  if(u_sine>0.5){ dx=sin(px.y/u_scale)*u_amt; dy=cos(px.x/u_scale)*u_amt; }
  else { vec2 cell=floor(px/u_scale); dx=(hash(cell)-0.5)*2.0*u_amt; dy=(hash(cell+vec2(99.0,17.0))-0.5)*2.0*u_amt; }
  o=texture(u_tex, v_uv+vec2(dx,dy)*u_texel); }`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_amt"), pn(p, "amount", 12) * u);
    gl.uniform1f(loc(gl, prog, "u_scale"), Math.max(0.5, pn(p, "scale", 3) * u) * 20);
    gl.uniform1f(loc(gl, prog, "u_sine"), ps(p, "type", "noise") === "sine" ? 1 : 0);
  },
};

// ---------------------------------------------------------------- sharpen
export const sharpen: GpuPass = {
  frag: f(`uniform float u_amount;
void main(){ vec3 c=texture(u_tex,v_uv).rgb;
  vec3 lapl=c*5.0 - texture(u_tex,v_uv+vec2(-u_texel.x,0)).rgb - texture(u_tex,v_uv+vec2(u_texel.x,0)).rgb
    - texture(u_tex,v_uv+vec2(0,-u_texel.y)).rgb - texture(u_tex,v_uv+vec2(0,u_texel.y)).rgb;
  o=vec4(clamp(mix(c,lapl,u_amount),0.0,1.0),texture(u_tex,v_uv).a); }`),
  setUniforms: (gl, prog, p) => gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 0.6)),
};

// ---------------------------------------------------------------- pixelate (square only; shapes bridge to CPU)
export const pixelate: GpuPass = {
  frag: f(`uniform float u_block;
void main(){ vec2 px=v_uv*u_dims; vec2 cell=(floor(px/u_block)+0.5)*u_block; o=texture(u_tex, cell*u_texel); }`),
  // Block size (incl. the animated depixelation level) comes from the shared
  // TS helper — same f64 value the CPU op uses, so animation is parity-free.
  setUniforms: (gl, prog, p, u, t) => gl.uniform1f(loc(gl, prog, "u_block"), pixelateBlock(p, u, t)),
};

// ---------------------------------------------------------------- CRT curvature
// Mirrors cpu/postfx.ts crtCurvature exactly: integer pixel coords (not pixel
// centres) for the barrel-warp math, NEAREST source sample via round(), and the
// same out-of-bounds → black / edge-darkening formulas. amount<=0 is a CPU
// no-op; the GL pass has no per-effect skip, so it passes the source through.
export const crtCurvature: GpuPass = {
  frag: f(`uniform float u_amount; uniform float u_edge;
void main(){
  vec4 c0=texture(u_tex,v_uv);
  if(u_amount<=0.0){ o=c0; return; }
  vec2 px=floor(vec2(v_uv.x, 1.0-v_uv.y)*u_dims);           // integer x,y (top-left origin)
  float cx=u_dims.x*0.5, cy=u_dims.y*0.5;
  float norm=max(cx,cy);
  float nx=(px.x-cx)/norm, ny=(px.y-cy)/norm;
  float r2=nx*nx+ny*ny;
  float k=1.0+u_amount*r2;
  float sx=cx+(px.x-cx)*k, sy=cy+(px.y-cy)*k;
  if(sx<0.0||sx>=u_dims.x||sy<0.0||sy>=u_dims.y){ o=vec4(0.0,0.0,0.0,1.0); return; }
  vec2 idx=clamp(floor(vec2(sx,sy)+0.5), vec2(0.0), u_dims-1.0);  // NEAREST (CPU round())
  vec3 src=texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0-(idx.y+0.5)/u_dims.y)).rgb;
  float dark=1.0-clamp((r2-(1.0-u_edge))/max(0.001,u_edge),0.0,1.0)*u_edge;
  o=vec4(src*dark, 1.0);
}`),
  setUniforms: (gl, prog, p) => {
    gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 0.25));
    gl.uniform1f(loc(gl, prog, "u_edge"), pn(p, "edge", 0.3));
  },
};

// ---------------------------------------------------------------- grain
// Deterministic GPU counterpart to cpu/ops.ts `grain`. The CPU op is
// stochastic (Math.random() per render), so pixel parity is impossible and
// not the goal — this defines the deterministic preview spec instead: same
// noise-grid cell size (nw x nh, computed CPU-side exactly like the CPU op),
// same canvas-drawImage nearest/bilinear upscize semantics, same blend +
// globalAlpha math. Noise comes from a well-mixed integer hash (not
// fract(sin(dot(...))*C), which loses precision at large fragment coords).
// u_frame drives a per-frame reseed when `animate` is on (24fps regrain,
// matching the CPU op re-rolling Math.random() every render); animate=false
// pins the seed to 0 for a stable still.
export const grain: GpuPass = {
  frag: f(`uniform float u_amount; uniform float u_size; uniform vec2 u_nwh; uniform float u_mono; uniform int u_blend; uniform int u_frame;
uint hash1(ivec2 p, int seed){
  uint h = uint(p.x)*1664525u ^ uint(p.y)*1013904223u ^ uint(seed)*2654435761u;
  h = (h ^ (h>>16u)) * 0x45d9f3bu;
  h = (h ^ (h>>16u)) * 0x45d9f3bu;
  h ^= (h>>16u);
  return h;
}
float hashf(ivec2 p, int seed){ return float(hash1(p, seed)) / 4294967295.0; }
// seed mixes the animate frame in via a golden-ratio scramble so consecutive
// frames don't correlate; animate=false always passes u_frame=0.
int seedFor(int channel){ int base = int(mod(float(u_frame)*0.61803398875, 1.0)*65536.0); return base + channel*7919; }
vec3 cellNoise(ivec2 cell, ivec2 nwh){
  ivec2 c = clamp(cell, ivec2(0), nwh-1);
  if(u_mono>0.5){ float v=hashf(c, seedFor(0)); return vec3(v); }
  return vec3(hashf(c, seedFor(0)), hashf(c, seedFor(1)), hashf(c, seedFor(2)));
}
vec3 blendMul(vec3 d,vec3 s){ return d*s; }
vec3 blendScreen(vec3 d,vec3 s){ return 1.0-(1.0-d)*(1.0-s); }
vec3 blendOverlay(vec3 d,vec3 s){ return mix(2.0*d*s, 1.0-2.0*(1.0-d)*(1.0-s), step(0.5,d)); }
vec3 blendSoft(vec3 d,vec3 s){ return mix(2.0*d*s + d*d*(1.0-2.0*s), sqrt(d)*(2.0*s-1.0)+2.0*d*(1.0-s), step(0.5,s)); }
vec3 hue2rgb(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
vec3 rgb2hsl(vec3 c){ float mx=max(max(c.r,c.g),c.b); float mn=min(min(c.r,c.g),c.b); float l=(mx+mn)*0.5; float h=0.0,s=0.0; float d=mx-mn;
  if(d>1e-5){ s=l>0.5? d/(2.0-mx-mn): d/(mx+mn); if(mx==c.r) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(mx==c.g) h=(c.b-c.r)/d+2.0; else h=(c.r-c.g)/d+4.0; h/=6.0; } return vec3(h,s,l); }
vec3 hsl2rgb(vec3 hsl){ float h=hsl.x,s=hsl.y,l=hsl.z; if(s<1e-5) return vec3(l); vec3 rgb=hue2rgb(h); float c=(1.0-abs(2.0*l-1.0))*s; return (rgb-0.5)*c+l; }
vec3 blendColor(vec3 d,vec3 s){ vec3 ds=rgb2hsl(s); vec3 dd=rgb2hsl(d); return hsl2rgb(vec3(ds.x,ds.y,dd.z)); }
void main(){
  vec4 c=texture(u_tex,v_uv);
  if(u_amount<=0.0){ o=c; return; }
  ivec2 nwh = ivec2(u_nwh);
  vec2 px = vec2(v_uv.x*u_dims.x, (1.0-v_uv.y)*u_dims.y); // dest pixel coords, top-left origin
  vec3 nz;
  if(u_size<=1.5){
    // canvas NEAREST upscale: dest pixel centre -> source texel index
    ivec2 cell = ivec2(floor((px+0.5)*u_nwh/u_dims));
    nz = cellNoise(cell, nwh);
  } else {
    // canvas smoothed (bilinear) upscale: sample the 4 surrounding cell hashes
    vec2 n = (px+0.5)*(u_nwh/u_dims) - 0.5;
    vec2 nf = floor(n);
    vec2 frac = n - nf;
    ivec2 c00 = ivec2(nf);
    vec3 v00 = cellNoise(c00, nwh);
    vec3 v10 = cellNoise(c00+ivec2(1,0), nwh);
    vec3 v01 = cellNoise(c00+ivec2(0,1), nwh);
    vec3 v11 = cellNoise(c00+ivec2(1,1), nwh);
    nz = mix(mix(v00,v10,frac.x), mix(v01,v11,frac.x), frac.y);
  }
  vec3 b;
  if(u_blend==0) b=blendMul(c.rgb,nz); else if(u_blend==1) b=blendScreen(c.rgb,nz); else if(u_blend==2) b=blendOverlay(c.rgb,nz); else if(u_blend==4) b=blendColor(c.rgb,nz); else b=blendSoft(c.rgb,nz);
  o=vec4(mix(c.rgb,b,u_amount),c.a);
}`),
  setUniforms: (gl, prog, p, u, t, dims) => {
    const amount = pn(p, "amount", 0.14);
    const size = Math.max(1, pn(p, "size", 1.5) * u);
    const nw = Math.max(1, Math.round(dims.w / size));
    const nh = Math.max(1, Math.round(dims.h / size));
    const animate = pb(p, "animate", true);
    const frame = animate ? Math.floor(t * 24) : 0;
    gl.uniform1f(loc(gl, prog, "u_amount"), amount);
    gl.uniform1f(loc(gl, prog, "u_size"), size);
    gl.uniform2f(loc(gl, prog, "u_nwh"), nw, nh);
    gl.uniform1f(loc(gl, prog, "u_mono"), pb(p, "mono", true) ? 1 : 0);
    const blends: Record<string, number> = { multiply: 0, screen: 1, overlay: 2, "soft-light": 3, color: 4 };
    gl.uniform1i(loc(gl, prog, "u_blend"), blends[ps(p, "blend", "soft-light")] ?? 3);
    gl.uniform1i(loc(gl, prog, "u_frame"), frame);
  },
};

// ---------------------------------------------------------------- lightRays
// GPU accelerator for the CPU `lightRays` op (ops.ts) — the two implement ONE
// spec: bloom's exact 8-bit bright threshold, integer texel sample positions
// floor(p + delta*(i+t0) + 0.5) idx-clamped, iterative decay weights, and a
// per-pixel blue-noise ray phase t0 from the shared BLUE_NOISE_128 table
// (F4 sampler — same bytes the CPU indexes). u_strengthNorm and u_densN are
// TS-computed (f64) so both engines see identical scalars. Parity tier is
// statistical: the only cross-engine divergence is rare f32/f64 floor ties on
// sample positions (one bright texel on one of N samples).
export const lightRays: GpuPass = {
  samplers: [{ name: "u_bn", key: "blueNoise128" }],
  frag: f(`const int N_MAX = 64;
uniform vec2 u_light; uniform float u_thr255; uniform int u_samples;
uniform float u_densN; uniform float u_decay; uniform float u_strengthNorm;
uniform vec3 u_color; uniform float u_blend;
uniform sampler2D u_bn;
vec3 nearestTexel(vec2 samplePos){
  vec2 idx=clamp(floor(samplePos+0.5), vec2(0.0), u_dims-1.0);
  return texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0-(idx.y+0.5)/u_dims.y)).rgb;
}
void main(){
  vec2 px=floor(vec2(v_uv.x, 1.0-v_uv.y)*u_dims); // integer x,y (top-left origin), matches CPU loop
  vec3 base=nearestTexel(px);
  float srcAlpha=texture(u_tex,v_uv).a;
  ivec2 ip=ivec2(px);
  float bn=floor(texelFetch(u_bn, ivec2(ip.x & 127, ip.y & 127), 0).r*255.0 + 0.5);
  float t0=(bn+0.5)/256.0;
  vec2 delta=(u_light-px)*u_densN;
  vec3 acc=vec3(0.0);
  float w=1.0;
  for(int i=0;i<N_MAX;i++){
    if(i>=u_samples) break;
    vec3 c8=floor(nearestTexel(px+delta*(float(i)+t0))*255.0+0.5);
    if(luma601(c8)>=u_thr255) acc+=(c8/255.0)*w;
    w*=u_decay;
  }
  vec3 rays=acc*u_strengthNorm*u_color;
  vec3 outc = u_blend>0.5
    ? 1.0-(1.0-base)*(1.0-clamp(rays,vec3(0.0),vec3(1.0)))
    : clamp(base+rays, 0.0, 1.0);
  o=vec4(clamp(outc,0.0,1.0), srcAlpha);
}`),
  setUniforms: (gl, prog, p, u, t, dims) => {
    const N = Math.max(1, Math.round(pn(p, "samples", 32)));
    const decay = pn(p, "decay", 0.95);
    const norm = decay < 1 ? (1 - decay) / (1 - Math.pow(decay, N)) : 1 / N;
    gl.uniform2f(loc(gl, prog, "u_light"), (pn(p, "x", 50) / 100) * dims.w, (pn(p, "y", 25) / 100) * dims.h);
    gl.uniform1f(loc(gl, prog, "u_thr255"), pn(p, "threshold", 0.6) * 255);
    gl.uniform1i(loc(gl, prog, "u_samples"), N);
    gl.uniform1f(loc(gl, prog, "u_densN"), pn(p, "density", 0.8) / N);
    gl.uniform1f(loc(gl, prog, "u_decay"), decay);
    gl.uniform1f(loc(gl, prog, "u_strengthNorm"), pn(p, "strength", 0.7) * norm);
    const [r, g, b] = hexRGB(ps(p, "color", "#ffe3b8"));
    gl.uniform3f(loc(gl, prog, "u_color"), r / 255, g / 255, b / 255);
    gl.uniform1f(loc(gl, prog, "u_blend"), ps(p, "blend", "screen") === "screen" ? 1 : 0);
  },
};
