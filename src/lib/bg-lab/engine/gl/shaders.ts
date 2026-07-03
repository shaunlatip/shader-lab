// BG Lab — GPU-native effect passes. Each entry is a fragment shader plus a
// uniform setter; the engine runs them as single fragment passes over the
// ping-pong chain (or, for `multi` ops, N same-size steps via MultiPassCtx —
// see blur/bloom/characterBloom below). Ops NOT listed here (CMYK/
// error-diffusion dither, shaped pixelate, gradient maps with >8 stops, and
// all glyph/converter styles except kuwahara and lineArt) run through the
// CPU bridge instead — see glEngine.shouldBridge.

import type { EffectType, ParamValue } from "../../types";
import { hexRGB, pb, pn, ps, pstops } from "../cpu/util";

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
  temp: (name: string) => { tex: WebGLTexture };
  run: (
    frag: string,
    dst: { tex: WebGLTexture },
    reads: { name: string; tex: WebGLTexture }[],
    set?: (gl: WebGL2RenderingContext, prog: WebGLProgram) => void,
  ) => void;
}

export interface GpuPass {
  /** Single-pass fragment source. Exactly one of `frag` / `multi` is set. */
  frag?: string;
  /** Extra sampler bindings: uniform `name` reads asset `key` (single-pass). */
  samplers?: { name: string; key: AssetTexKey }[];
  setUniforms?: (gl: WebGL2RenderingContext, prog: WebGLProgram, p: Record<string, ParamValue>, u: number, t: number, dims: { w: number; h: number }) => void;
  /** F5a multi-pass body: run N same-size steps via the ctx. */
  multi?: (ctx: MultiPassCtx, p: Record<string, ParamValue>, u: number, t: number, dims: { w: number; h: number }) => void;
  /** Static list of every frag a `multi` op can run — dev self-check compiles
   * these at startup (single-pass ops are checked via `frag`). */
  frags?: string[];
}

const HEADER = `#version 300 es
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

const f = (body: string) => HEADER + body;
const col = (p: Record<string, ParamValue>, k: string, d: string): [number, number, number] => {
  const [r, g, b] = hexRGB(ps(p, k, d));
  return [r / 255, g / 255, b / 255];
};
// Per-program uniform-location cache (self-cleaning: WeakMap keyed off the program).
// Caches null too — a missing uniform re-queries otherwise, once per pass per frame.
const LOCS = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
const loc = (gl: WebGL2RenderingContext, prog: WebGLProgram, n: string) => {
  let m = LOCS.get(prog);
  if (!m) LOCS.set(prog, (m = new Map()));
  if (m.has(n)) return m.get(n)!;
  const l = gl.getUniformLocation(prog, n);
  m.set(n, l);
  return l;
};

// ---------------------------------------------------------------- grayscale
const grayscale: GpuPass = {
  frag: f(`uniform float u_amount;
void main(){ vec4 c=texture(u_tex,v_uv); float l=luma601(c.rgb); o=vec4(mix(c.rgb,vec3(l),u_amount),c.a); }`),
  setUniforms: (gl, prog, p) => gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 1)),
};

// ---------------------------------------------------------------- threshold
const threshold: GpuPass = {
  frag: f(`uniform float u_level; uniform float u_amount;
void main(){ vec4 c=texture(u_tex,v_uv); float v=luma601(c.rgb)>=u_level?1.0:0.0; o=vec4(mix(c.rgb,vec3(v),u_amount),c.a); }`),
  setUniforms: (gl, prog, p) => {
    gl.uniform1f(loc(gl, prog, "u_level"), pn(p, "level", 0.5));
    gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 1));
  },
};

// ---------------------------------------------------------------- posterize
const posterize: GpuPass = {
  frag: f(`uniform float u_levels; uniform float u_perch;
float q(float v,float L){ return floor(v*(L-1.0)+0.5)/(L-1.0); }
void main(){ vec4 c=texture(u_tex,v_uv); float L=u_levels;
  if(u_perch>0.5){ o=vec4(q(c.r,L),q(c.g,L),q(c.b,L),c.a); }
  else { float l=luma601(c.rgb); float k= l>0.0? q(l,L)/l : 0.0; o=vec4(clamp(c.rgb*k,0.0,1.0),c.a); } }`),
  setUniforms: (gl, prog, p) => {
    gl.uniform1f(loc(gl, prog, "u_levels"), Math.max(2, Math.round(pn(p, "levels", 5))));
    gl.uniform1f(loc(gl, prog, "u_perch"), pb(p, "perChannel", true) ? 1 : 0);
  },
};

// ---------------------------------------------------------------- tint / color overlay
const tint: GpuPass = {
  frag: f(`uniform vec3 u_color; uniform float u_opacity; uniform int u_blend;
vec3 blendMul(vec3 d,vec3 s){ return d*s; }
vec3 blendScreen(vec3 d,vec3 s){ return 1.0-(1.0-d)*(1.0-s); }
vec3 blendOverlay(vec3 d,vec3 s){ return mix(2.0*d*s, 1.0-2.0*(1.0-d)*(1.0-s), step(0.5,d)); }
vec3 blendSoft(vec3 d,vec3 s){ return mix(2.0*d*s + d*d*(1.0-2.0*s), sqrt(d)*(2.0*s-1.0)+2.0*d*(1.0-s), step(0.5,s)); }
vec3 hue2rgb(float h){ return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0); }
vec3 rgb2hsl(vec3 c){ float mx=max(max(c.r,c.g),c.b); float mn=min(min(c.r,c.g),c.b); float l=(mx+mn)*0.5; float h=0.0,s=0.0; float d=mx-mn;
  if(d>1e-5){ s=l>0.5? d/(2.0-mx-mn): d/(mx+mn); if(mx==c.r) h=(c.g-c.b)/d+(c.g<c.b?6.0:0.0); else if(mx==c.g) h=(c.b-c.r)/d+2.0; else h=(c.r-c.g)/d+4.0; h/=6.0; } return vec3(h,s,l); }
vec3 hsl2rgb(vec3 hsl){ float h=hsl.x,s=hsl.y,l=hsl.z; if(s<1e-5) return vec3(l); vec3 rgb=hue2rgb(h); float c=(1.0-abs(2.0*l-1.0))*s; return (rgb-0.5)*c+l; }
vec3 blendColor(vec3 d,vec3 s){ vec3 ds=rgb2hsl(s); vec3 dd=rgb2hsl(d); return hsl2rgb(vec3(ds.x,ds.y,dd.z)); }
void main(){ vec4 c=texture(u_tex,v_uv); vec3 s=u_color; vec3 b;
  if(u_blend==0) b=blendMul(c.rgb,s); else if(u_blend==1) b=blendScreen(c.rgb,s); else if(u_blend==2) b=blendOverlay(c.rgb,s); else if(u_blend==3) b=blendSoft(c.rgb,s); else b=blendColor(c.rgb,s);
  o=vec4(mix(c.rgb,b,u_opacity),c.a); }`),
  setUniforms: (gl, prog, p) => {
    gl.uniform3f(loc(gl, prog, "u_color"), ...col(p, "color", "#000000"));
    gl.uniform1f(loc(gl, prog, "u_opacity"), pn(p, "opacity", 0.25));
    const blends: Record<string, number> = { multiply: 0, screen: 1, overlay: 2, "soft-light": 3, color: 4 };
    gl.uniform1i(loc(gl, prog, "u_blend"), blends[ps(p, "blend", "multiply")] ?? 0);
  },
};

// ---------------------------------------------------------------- scanlines / CRT lines
const scanlines: GpuPass = {
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
const vignette: GpuPass = {
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

// ---------------------------------------------------------------- adjust
const adjust: GpuPass = {
  frag: f(`uniform float u_b; uniform float u_c; uniform float u_s; uniform float u_hue;
uniform float u_exp; uniform float u_temp; uniform float u_gamma;
vec3 hueRotate(vec3 c,float deg){ float a=radians(deg); float cs=cos(a),sn=sin(a);
  mat3 m=mat3(0.213,0.213,0.213,0.715,0.715,0.715,0.072,0.072,0.072)
    + cs*mat3(0.787,-0.213,-0.213,-0.715,0.285,-0.715,-0.072,-0.072,0.928)
    + sn*mat3(-0.213,-0.715,0.928,0.143,0.140,-0.283,-0.787,0.715,0.072);
  return c*m; }
void main(){ vec4 col4=texture(u_tex,v_uv); vec3 c=col4.rgb;
  c*=u_b;                                   // brightness
  c=(c-0.5)*u_c+0.5;                          // contrast
  float l=dot(c,vec3(0.213,0.715,0.072)); c=mix(vec3(l),c,u_s); // saturate
  c=hueRotate(c,u_hue);
  c=clamp(c,0.0,1.0);
  c*=pow(2.0,u_exp);                          // exposure
  c.r+=u_temp*40.0/255.0; c.b-=u_temp*40.0/255.0; // temperature
  c=clamp(c,0.0,1.0);
  c=pow(c, vec3(1.0/u_gamma));                // gamma
  o=vec4(clamp(c,0.0,1.0),col4.a); }`),
  setUniforms: (gl, prog, p) => {
    gl.uniform1f(loc(gl, prog, "u_b"), pn(p, "brightness", 1));
    gl.uniform1f(loc(gl, prog, "u_c"), pn(p, "contrast", 1));
    gl.uniform1f(loc(gl, prog, "u_s"), pn(p, "saturation", 1));
    gl.uniform1f(loc(gl, prog, "u_hue"), pn(p, "hue", 0));
    gl.uniform1f(loc(gl, prog, "u_exp"), pn(p, "exposure", 0));
    gl.uniform1f(loc(gl, prog, "u_temp"), pn(p, "temperature", 0));
    gl.uniform1f(loc(gl, prog, "u_gamma"), Math.max(0.01, pn(p, "gamma", 1)));
  },
};

// ---------------------------------------------------------------- chromatic aberration / dispersion
const chromatic: GpuPass = {
  frag: f(`uniform float u_amt; uniform float u_ax; uniform float u_ay; uniform float u_radial;
uniform int u_samples; uniform float u_sat;
void main(){
  vec2 px=v_uv*u_dims;
  vec2 bdir=vec2(u_ax,u_ay); // unit direction for split/linear mode
  if(u_radial>0.5){ vec2 d=px-u_dims*0.5; bdir=d/max(1.0,length(d)); }
  // multi-sample dispersion: R×1 G×2 B×3 per-channel multipliers
  vec3 acc=vec3(0.0);
  for(int i=0;i<16;i++){
    if(i>=u_samples) break;
    float slide=(float(i)/float(u_samples))*0.1;
    float s=(u_amt+slide);
    acc.r+=texture(u_tex,v_uv+bdir*s*1.0*u_texel).r;
    acc.g+=texture(u_tex,v_uv+bdir*s*2.0*u_texel).g;
    acc.b+=texture(u_tex,v_uv+bdir*s*3.0*u_texel).b;
  }
  acc/=float(u_samples);
  // saturation: mix(luma, rgb, u_sat) — luma-preserving
  float lum=luma601(acc);
  vec3 rgb=mix(vec3(lum),acc,u_sat);
  o=vec4(rgb,texture(u_tex,v_uv).a);
  // future: rygcbv 6-wavelength expansion (quality:high) for finer dispersion
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
  },
};

// ---------------------------------------------------------------- displace / warp
const displace: GpuPass = {
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
const sharpen: GpuPass = {
  frag: f(`uniform float u_amount;
void main(){ vec3 c=texture(u_tex,v_uv).rgb;
  vec3 lapl=c*5.0 - texture(u_tex,v_uv+vec2(-u_texel.x,0)).rgb - texture(u_tex,v_uv+vec2(u_texel.x,0)).rgb
    - texture(u_tex,v_uv+vec2(0,-u_texel.y)).rgb - texture(u_tex,v_uv+vec2(0,u_texel.y)).rgb;
  o=vec4(clamp(mix(c,lapl,u_amount),0.0,1.0),texture(u_tex,v_uv).a); }`),
  setUniforms: (gl, prog, p) => gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 0.6)),
};

// ---------------------------------------------------------------- pixelate (square only; shapes bridge to CPU)
const pixelate: GpuPass = {
  frag: f(`uniform float u_block;
void main(){ vec2 px=v_uv*u_dims; vec2 cell=(floor(px/u_block)+0.5)*u_block; o=texture(u_tex, cell*u_texel); }`),
  setUniforms: (gl, prog, p, u) => gl.uniform1f(loc(gl, prog, "u_block"), Math.max(1, pn(p, "size", 8) * u)),
};

// ---------------------------------------------------------------- ordered dither (diffusion modes bridge to CPU)
const dither: GpuPass = {
  samplers: [{ name: "u_bn", key: "blueNoise128" }],
  frag: f(`uniform float u_levels; uniform float u_scale; uniform float u_mono; uniform int u_type; uniform float u_pixelate;
uniform sampler2D u_bn; // 128^2 blue-noise bytes (F8), same array as the CPU op
// toLin/toSRGB come from the F2 HEADER prelude — redeclaring them here was a
// GLSL redefinition error: the pass failed to compile and Stage's fallback
// silently demoted the whole session to the CPU engine.
float bayer2(ivec2 p){ int v=(p.y%2)*2+(p.x%2); float t[4]=float[4](0.0,2.0,3.0,1.0); return (t[v]+0.5)/4.0; }
float bayer4(ivec2 p){ int x=p.x%4,y=p.y%4; float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.); return (m[y*4+x]+0.5)/16.0; }
float bayer8(ivec2 p){ int x=p.x%8,y=p.y%8; float m[64]=float[64](
 0.,32.,8.,40.,2.,34.,10.,42.,48.,16.,56.,24.,50.,18.,58.,26.,
 12.,44.,4.,36.,14.,46.,6.,38.,60.,28.,52.,20.,62.,30.,54.,22.,
 3.,35.,11.,43.,1.,33.,9.,41.,51.,19.,59.,27.,49.,17.,57.,25.,
 15.,47.,7.,39.,13.,45.,5.,37.,63.,31.,55.,23.,61.,29.,53.,21.);
 return (m[y*8+x]+0.5)/64.0; }
// blueNoise threshold: real void-and-cluster matrix via u_bn texelFetch —
// snap the R8 read back to the exact byte so it thresholds identically to
// the CPU's (v + 0.5)/256 (replaced the old IGN approximation, F8).
float bnoise(ivec2 cell){
  float v = floor(texelFetch(u_bn, ivec2(cell.x & 127, cell.y & 127), 0).r*255.0 + 0.5);
  return (v + 0.5)/256.0;
}
// Stylized 8x8 matrices (Heckel §C4): stripe + cross-stripe
float stripe8(ivec2 p){ int x=p.x%8,y=p.y%8; float m[64]=float[64](
 0.,8.,16.,24.,32.,40.,48.,56.,
 4.,12.,20.,28.,36.,44.,52.,60.,
 8.,16.,24.,32.,40.,48.,56.,0.,
 12.,20.,28.,36.,44.,52.,60.,4.,
 16.,24.,32.,40.,48.,56.,0.,8.,
 20.,28.,36.,44.,52.,60.,4.,12.,
 24.,32.,40.,48.,56.,0.,8.,16.,
 28.,36.,44.,52.,60.,4.,12.,20.);
 return (m[y*8+x]+0.5)/64.0; }
float crossStripe8(ivec2 p){ int x=p.x%8,y=p.y%8; float m[64]=float[64](
 0.,12.,24.,36.,48.,60.,8.,20.,
 16.,28.,40.,52.,4.,56.,32.,44.,
 8.,20.,0.,12.,24.,36.,48.,60.,
 40.,52.,16.,28.,4.,56.,32.,44.,
 48.,60.,8.,20.,0.,12.,24.,36.,
 32.,44.,40.,52.,16.,28.,4.,56.,
 24.,36.,48.,60.,8.,20.,0.,12.,
 56.,4.,32.,44.,40.,52.,16.,28.);
 return (m[y*8+x]+0.5)/64.0; }
void main(){
  vec2 px=vec2(v_uv.x*u_dims.x,(1.0-v_uv.y)*u_dims.y);
  // pixelate-per-cell: snap source UV to block origin when u_pixelate>0
  vec2 srcPx = u_pixelate>0.5 ? floor(px/u_pixelate)*u_pixelate : px;
  vec2 srcUv = clamp(srcPx*u_texel, vec2(0.0), vec2(1.0));
  srcUv.y = 1.0-srcUv.y;
  vec4 c=texture(u_tex,srcUv);
  ivec2 cell=ivec2(floor(px/u_scale));
  float m;
  if(u_type==0)      m=bayer2(cell);
  else if(u_type==2) m=bayer8(cell);
  else if(u_type==3) m=bnoise(cell);
  else if(u_type==4) m=stripe8(cell);
  else if(u_type==5) m=crossStripe8(cell);
  else               m=bayer4(cell);
  m-=0.5;
  float L=u_levels;
  // quantize in linear light
  vec3 lin=toLin(c.rgb);
  vec3 rgb;
  if(u_mono>0.5){ float v=luma601(lin); v=clamp(floor(v*(L-1.0)+m+0.5),0.0,L-1.0)/(L-1.0); rgb=toSRGB(vec3(v)); }
  // clamp needs matching min/max types: (vec3, float, vec3) is an invalid GLSL
  // overload and made this pass fail to compile (→ silent CPU demotion).
  else { rgb=toSRGB(clamp(floor(lin*(L-1.0)+m+0.5),vec3(0.0),vec3(L-1.0))/(L-1.0)); }
  o=vec4(rgb,c.a); }`),
  setUniforms: (gl, prog, p, u) => {
    const types: Record<string, number> = { bayer2: 0, bayer4: 1, bayer8: 2, blueNoise: 3, stripes: 4, crossStripe: 5 };
    gl.uniform1i(loc(gl, prog, "u_type"), types[ps(p, "type", "bayer4")] ?? 1);
    gl.uniform1f(loc(gl, prog, "u_levels"), Math.max(2, Math.round(pn(p, "levels", 3))));
    gl.uniform1f(loc(gl, prog, "u_scale"), Math.max(1, Math.round(pn(p, "scale", 2) * u)));
    gl.uniform1f(loc(gl, prog, "u_mono"), pb(p, "mono", false) ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_pixelate"), Math.max(0, Math.round(pn(p, "pixelate", 0) * u)));
  },
};

// ---------------------------------------------------------------- halftone (mono + CMYK)
// GPU accelerator for the CPU `halftone` op (ops.ts) — the two implement ONE
// lattice/sampling/AA spec (roadmap §2 parity contract; the CPU op is a per-pixel
// mirror of this shader): screen rotated about the canvas centre, grid phased from
// -diag/2 (diag = ceil(hypot(W,H))), cell-centre coverage sampled NEAREST in
// PERCEPTUAL sRGB (luma601 — NOT linear; linear over-inks mid-tones), uniform
// radius r = sqrt(cov)*cell*0.71 (= (cell/2)*1.42) for every shape.
// AA is aaCov: a deterministic 1px linear area ramp on the SDF in PX units —
// NOT the F2 fwidth aaMask (2px smoothstep, GPU-dependent) and NOT canvas fills
// (Skia analytic AA): those two could never agree, and were the harness's
// 12.7/255 mean halftone parity gap. Change aaCov on both sides or neither.
// A 3x3 cell-neighbourhood union reproduces overlapping dots at high coverage
// (a single fract() cell would clip dots at the cell border).
// CMYK (u_mode=1): four rotated screens (C15 M75 Y0 K45), in-shader rgb2cmyk with K
// extraction, composited by MULTIPLY over white per neighbouring dot; the CPU op
// multiplies in float and quantises once, same as the GPU.
const halftone: GpuPass = {
  frag: f(`uniform float u_cell;     // px (already * unit, >= 2)
uniform float u_angle;    // degrees (mono screen angle)
uniform float u_contrast;
uniform int   u_shape;    // 0 circle 1 ring 2 line 3 square 4 diamond
uniform float u_stagger;  // 0/1
uniform float u_invert;   // 0/1
uniform float u_mode;     // 0 mono, 1 cmyk
uniform vec3  u_ink;
uniform vec3  u_paper;
uniform float u_rscale;   // 0.71*(1 + overflow*0.9) — dot radius scale
uniform float u_gooeyK;   // smin k in cell units; 0 = hard min
uniform float u_combine;  // CMYK: 1 = fold per screen (overflow/gooey), 0 = per-dot legacy
float dotSDF(vec2 cc, float r, int shape){
  if(shape==3) return max(abs(cc.x),abs(cc.y)) - r;            // square (L-inf)
  if(shape==4) return abs(cc.x)+abs(cc.y) - r;                 // diamond (L1)
  if(shape==2) return abs(cc.y) - r*0.5;                       // line (full-width bar)
  if(shape==1){ float d=length(cc); return max(d - r, r*0.55 - d); } // ring (annulus)
  return length(cc) - r;                                       // circle
}
// 1px linear area ramp on the SDF in PX units — the shared CPU/GL AA spec
// (see block comment above). dPx = dotSDF(...)*cell.
float aaCov(float dPx){ return clamp(0.5 - dPx, 0.0, 1.0); }
// iq polynomial smooth-min — the gooey merge. smin(1e9, d, k) == min, so the
// fold needs no init guard (same on the CPU side).
float smin(float a, float b, float k){ float h = max(k - abs(a-b), 0.0)/k; return min(a,b) - h*h*k*0.25; }
// One rotated CMYK screen over the 3x3 cell neighbourhood. Legacy: each dot
// multiplies independently (canvas-'multiply' heritage). Combined
// (overflow/gooey): fold the SDFs, multiply the screen's ink ONCE — merged
// dots must not double-ink.
void cmykScreen(inout vec3 res, vec2 P, vec2 ctr, float cell, float angDeg, vec3 inkCol, int chan){
  float ang = radians(angDeg), cs = cos(ang), sn = sin(ang);
  vec2  dP = P - ctr;
  vec2  Q  = vec2(cs*dP.x + sn*dP.y, -sn*dP.x + cs*dP.y);
  float diag = ceil(sqrt(dot(u_dims, u_dims)));
  float A = -0.5*diag + 0.5*cell;
  float kx0 = floor((Q.x - A)/cell + 0.5), ky0 = floor((Q.y - A)/cell + 0.5);
  float dAcc = 1e9;
  for(int dy=-1; dy<=1; dy++){
    float ky = ky0 + float(dy);
    float rowOff = (u_stagger > 0.5 && mod(ky,2.0) > 0.5) ? 0.5*cell : 0.0;
    for(int dx=-1; dx<=1; dx++){
      float kx = kx0 + float(dx);
      vec2  C  = vec2(A + rowOff + kx*cell, A + ky*cell);
      vec2  cc = (Q - C)/cell;
      vec2  Pc = vec2(cs*C.x - sn*C.y, sn*C.x + cs*C.y) + ctr;
      vec2  idx = clamp(floor(Pc + 0.5), vec2(0.0), u_dims - 1.0);
      vec3  src = texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0 - (idx.y+0.5)/u_dims.y)).rgb;
      float k = min(1.0-src.r, min(1.0-src.g, 1.0-src.b));     // rgb2cmyk, K extraction
      float cov;
      if(chan==3){ cov = k; }
      else { float denom = 1.0 - k; vec3 cmy = denom > 1e-6 ? (1.0 - src - k)/denom : vec3(0.0);
             cov = chan==0 ? cmy.x : (chan==1 ? cmy.y : cmy.z); }
      cov = (u_invert > 0.5) ? 1.0 - cov : cov;
      cov = pow(clamp(cov, 0.0, 1.0), u_contrast);
      float r = sqrt(cov) * u_rscale;
      if(r*cell <= 0.2) continue;
      float d = dotSDF(cc, r, u_shape);
      if(u_combine > 0.5){ dAcc = u_gooeyK > 0.0 ? smin(dAcc, d, u_gooeyK) : min(dAcc, d); }
      else res *= mix(vec3(1.0), inkCol, aaCov(d*cell));
    }
  }
  if(u_combine > 0.5) res *= mix(vec3(1.0), inkCol, aaCov(dAcc*cell));
}
void main(){
  float cell = max(2.0, u_cell);
  vec2  P    = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;            // canvas px, top-left origin
  vec2  ctr  = 0.5 * u_dims;
  if(u_mode > 0.5){                                            // CMYK: white paper, multiply inks
    vec3 res = vec3(1.0);
    cmykScreen(res, P, ctr, cell, 15.0, vec3(0.0,    0.6824, 0.9373), 0);  // C #00aeef
    cmykScreen(res, P, ctr, cell, 75.0, vec3(0.9255, 0.0,    0.5490), 1);  // M #ec008c
    cmykScreen(res, P, ctr, cell,  0.0, vec3(1.0,    0.9490, 0.0   ), 2);  // Y #fff200
    cmykScreen(res, P, ctr, cell, 45.0, vec3(0.1020, 0.1020, 0.1020), 3);  // K #1a1a1a
    o = vec4(res, 1.0); return;
  }
  // mono: paper + single ink screen
  float ang  = radians(u_angle);
  float cs   = cos(ang), sn = sin(ang);
  vec2  dP   = P - ctr;
  vec2  Q    = vec2(cs*dP.x + sn*dP.y, -sn*dP.x + cs*dP.y);    // into the rotated grid frame
  float diag = ceil(sqrt(dot(u_dims, u_dims)));
  float A    = -0.5*diag + 0.5*cell;                          // first cell-centre coord (CPU -diag/2 phase)
  float kx0  = floor((Q.x - A)/cell + 0.5);
  float ky0  = floor((Q.y - A)/cell + 0.5);
  float dAcc = 1e9;
  for(int dy=-1; dy<=1; dy++){
    float ky = ky0 + float(dy);
    float rowOff = (u_stagger > 0.5 && mod(ky,2.0) > 0.5) ? 0.5*cell : 0.0;
    for(int dx=-1; dx<=1; dx++){
      float kx = kx0 + float(dx);
      vec2  C  = vec2(A + rowOff + kx*cell, A + ky*cell);      // cell centre in rotated frame
      vec2  cc = (Q - C)/cell;                                // local coord, ~[-0.5,0.5] in home cell
      vec2  Pc = vec2(cs*C.x - sn*C.y, sn*C.x + cs*C.y) + ctr; // cell centre back in canvas px
      vec2  idx = clamp(floor(Pc + 0.5), vec2(0.0), u_dims - 1.0); // NEAREST texel (CPU round())
      vec3  src = texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0 - (idx.y+0.5)/u_dims.y)).rgb;
      float cov = 1.0 - luma601(src);                          // PERCEPTUAL sRGB coverage
      cov = (u_invert > 0.5) ? 1.0 - cov : cov;
      cov = pow(clamp(cov, 0.0, 1.0), u_contrast);
      float r = sqrt(cov) * u_rscale;                          // cell-fraction radius
      if(r*cell <= 0.2) continue;                              // shared dot-skip threshold (px)
      float d = dotSDF(cc, r, u_shape);
      // SDF fold + one aaCov == the old per-dot coverage max (aaCov is
      // monotonic in d) — and gives smin the whole dot set to merge.
      dAcc = u_gooeyK > 0.0 ? smin(dAcc, d, u_gooeyK) : min(dAcc, d);
    }
  }
  float ink = aaCov(dAcc*cell);
  o = vec4(mix(u_paper, u_ink, ink), 1.0);
}`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_cell"), Math.max(2, pn(p, "cell", 9) * u));
    gl.uniform1f(loc(gl, prog, "u_angle"), pn(p, "angle", 45));
    gl.uniform1f(loc(gl, prog, "u_contrast"), pn(p, "contrast", 1));
    gl.uniform1i(loc(gl, prog, "u_shape"), ["circle", "ring", "line", "square", "diamond"].indexOf(ps(p, "dotShape", "circle")));
    gl.uniform1f(loc(gl, prog, "u_stagger"), pb(p, "stagger", false) ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_invert"), pb(p, "invertCells", false) ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_mode"), ps(p, "mode", "mono") === "cmyk" ? 1 : 0);
    gl.uniform3fv(loc(gl, prog, "u_ink"), col(p, "ink", "#191512"));
    gl.uniform3fv(loc(gl, prog, "u_paper"), col(p, "paper", "#f1ece4"));
    const overflow = Math.min(1, Math.max(0, pn(p, "overflow", 0)));
    const gooey = Math.min(1, Math.max(0, pn(p, "gooey", 0)));
    gl.uniform1f(loc(gl, prog, "u_rscale"), 0.71 * (1 + overflow * 0.9));
    gl.uniform1f(loc(gl, prog, "u_gooeyK"), gooey * 0.4);
    gl.uniform1f(loc(gl, prog, "u_combine"), overflow > 0 || gooey > 0 ? 1 : 0);
  },
};

// ---------------------------------------------------------------- CRT curvature
// Mirrors cpu/postfx.ts crtCurvature exactly: integer pixel coords (not pixel
// centres) for the barrel-warp math, NEAREST source sample via round(), and the
// same out-of-bounds → black / edge-darkening formulas. amount<=0 is a CPU
// no-op; the GL pass has no per-effect skip, so it passes the source through.
const crtCurvature: GpuPass = {
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

// ---------------------------------------------------------------- gradient map
// Mirrors cpu/ops.ts gradientMap: an 8-bit-quantized LUT built from SORTED
// stops (segment search: first s where t>=stop[s].t && t<=stop[s+1].t, default
// a=first/b=last), keyed by Rec.709 luma (matches CPU `luma`, NOT luma601).
// Stops are passed as fixed-size uniform arrays (max 8; more bridges to CPU —
// see glEngine.shouldBridge). u_nstops===0 (fewer than 2 stops) passes through,
// matching the CPU op's early return.
const gradientMap: GpuPass = {
  frag: f(`uniform float u_stopT[8]; uniform vec3 u_stopC[8]; uniform int u_nstops; uniform float u_amount;
void main(){
  vec4 c=texture(u_tex,v_uv);
  if(u_nstops<2){ o=c; return; }
  float li=floor(luma709(c.rgb)*255.0+0.5);
  float t=li/255.0;
  int ai=0, bi=u_nstops-1;
  for(int s=0;s<7;s++){
    if(s>=u_nstops-1) break;
    if(t>=u_stopT[s] && t<=u_stopT[s+1]){ ai=s; bi=s+1; break; }
  }
  float at=u_stopT[ai], bt=u_stopT[bi];
  vec3 ca=u_stopC[ai], cb=u_stopC[bi];
  float span = (bt-at)==0.0 ? 1.0 : (bt-at);
  float k=clamp((t-at)/span,0.0,1.0);
  vec3 ramp=mix(ca,cb,k);
  ramp=floor(ramp*255.0+0.5)/255.0;                     // quantize to 8-bit, matching the CPU LUT
  o=vec4(mix(c.rgb,ramp,u_amount),c.a);
}`),
  setUniforms: (gl, prog, p) => {
    const stops = pstops(p, "stops");
    const sorted = [...stops].sort((a, b) => a.t - b.t).slice(0, 8);
    const n = sorted.length >= 2 ? sorted.length : 0;
    const tArr = new Float32Array(8);
    const cArr = new Float32Array(8 * 3);
    for (let i = 0; i < sorted.length; i++) {
      tArr[i] = sorted[i].t;
      const [r, g, b] = hexRGB(sorted[i].color);
      cArr[i * 3] = r / 255;
      cArr[i * 3 + 1] = g / 255;
      cArr[i * 3 + 2] = b / 255;
    }
    gl.uniform1fv(loc(gl, prog, "u_stopT[0]"), tArr);
    gl.uniform3fv(loc(gl, prog, "u_stopC[0]"), cArr);
    gl.uniform1i(loc(gl, prog, "u_nstops"), n);
    gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 1));
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
const grain: GpuPass = {
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
const kuwahara: GpuPass = {
  frag: f(`const int R_MAX = 12;
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
}`),
  setUniforms: (gl, prog, p, u) => {
    const radius = Math.min(12, Math.max(2, Math.round(pn(p, "radius", 4) * u)));
    const smooth = ps(p, "quality", "fast") === "smooth" ? 1 : 0;
    gl.uniform1i(loc(gl, prog, "u_radius"), radius);
    gl.uniform1i(loc(gl, prog, "u_smooth"), smooth);
  },
};

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
const lineArt: GpuPass = {
  frag: f(`const int T_MAX = 12;
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
}`),
  setUniforms: (gl, prog, p, u) => {
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
  },
};

// ---------------------------------------------------------------- copy (identity passthrough)
// F5a multi-pass ops always run their final step into ctx.output — the engine
// unconditionally ping-pongs — so an op's identity case (radius/intensity<=0,
// matching the CPU op's early `return`) still needs one GPU copy step.
const COPY_FRAG = f(`void main(){ o=texture(u_tex,v_uv); }`);

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

const blur: GpuPass = {
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

const BLOOM_FRAGS = [COPY_FRAG, BLOOM_BRIGHT_FRAG, BLOOM_GAUSS_FRAG, BLOOM_COMPOSITE_FRAG];

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

const bloom: GpuPass = {
  frags: BLOOM_FRAGS,
  multi: (ctx, p, u) => {
    const intensity = pn(p, "intensity", 0.5);
    const thr255 = pn(p, "threshold", 0.7) * 255;
    const radius = Math.max(0.5, pn(p, "radius", 12) * u);
    runBloomChain(ctx, intensity, thr255, radius);
  },
};

const characterBloom: GpuPass = {
  frags: BLOOM_FRAGS,
  multi: (ctx, p, u) => {
    const intensity = pn(p, "intensity", 0.7);
    const thr255 = pn(p, "threshold", 0.55) * 255;
    const radius = Math.max(0.5, pn(p, "radius", 6) * u);
    runBloomChain(ctx, intensity, thr255, radius);
  },
};

export const GL_OPS: Partial<Record<EffectType, GpuPass>> = {
  grayscale,
  threshold,
  posterize,
  tint,
  scanlines,
  vignette,
  adjust,
  chromatic,
  displace,
  sharpen,
  pixelate,
  dither,
  halftone,
  crtCurvature,
  gradientMap,
  grain,
  kuwahara,
  lineArt,
  blur,
  bloom,
  characterBloom,
};
