// BG Lab — GPU-native effect passes. Each entry is a fragment shader plus a
// uniform setter; the engine runs them as single fragment passes over the
// ping-pong chain. Ops NOT listed here (blur, bloom, grain, gradient map,
// CMYK/error-diffusion dither, shaped pixelate, and all glyph/converter styles)
// run through the CPU bridge instead — see glEngine.shouldBridge.

import type { EffectType, ParamValue } from "../../types";
import { hexRGB, pb, pn, ps } from "../cpu/util";

export interface GpuPass {
  frag: string;
  setUniforms: (gl: WebGL2RenderingContext, prog: WebGLProgram, p: Record<string, ParamValue>, u: number, t: number, dims: { w: number; h: number }) => void;
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
const loc = (gl: WebGL2RenderingContext, prog: WebGLProgram, n: string) => gl.getUniformLocation(prog, n);

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
  frag: f(`uniform float u_levels; uniform float u_scale; uniform float u_mono; uniform int u_type; uniform float u_pixelate;
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
float ign(vec2 p){ return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y)); }
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
  else if(u_type==3) m=ign(floor(px/u_scale));
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
// GPU accelerator for the CPU `halftone` op (ops.ts). Replicates the CPU lattice
// EXACTLY so GL preview == CPU still-export: screen rotated about the canvas centre,
// grid phased from -diag/2 (diag = ceil(hypot(W,H))), cell-centre coverage sampled
// NEAREST in PERCEPTUAL sRGB (luma601 — NOT linear; linear over-inks mid-tones),
// uniform radius r = sqrt(cov)*cell*0.71 (= (cell/2)*1.42) for every shape, AA always
// on (canvas fills always antialias; the `aa` toggle is a no-op on the CPU path too).
// A 3x3 cell-neighbourhood union reproduces the CPU's painted-over overlapping dots
// at high coverage (a single fract() cell would clip dots at the cell border).
// CMYK (u_mode=1): four rotated screens (C15 M75 Y0 K45), in-shader rgb2cmyk with K
// extraction, composited by MULTIPLY over white per neighbouring dot — mirrors the CPU
// canvas globalCompositeOperation:"multiply" of four AA'd ink layers (ops.ts:716-774).
// Near-exact vs CPU: the CPU quantises to 8-bit after each of the 4 layer composites,
// the GPU multiplies in float and quantises once, so overlaps can differ by <=1 LSB.
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
float dotSDF(vec2 cc, float r, int shape){
  if(shape==3) return max(abs(cc.x),abs(cc.y)) - r;            // square (L-inf)
  if(shape==4) return abs(cc.x)+abs(cc.y) - r;                 // diamond (L1)
  if(shape==2) return abs(cc.y) - r*0.5;                       // line (full-width bar)
  if(shape==1){ float d=length(cc); return max(d - r, r*0.55 - d); } // ring (annulus)
  return length(cc) - r;                                       // circle
}
// One rotated CMYK screen, multiplied into res over the 3x3 cell neighbourhood
// (each dot multiplies independently, matching canvas 'multiply' of overlapping fills).
void cmykScreen(inout vec3 res, vec2 P, vec2 ctr, float cell, float angDeg, vec3 inkCol, int chan){
  float ang = radians(angDeg), cs = cos(ang), sn = sin(ang);
  vec2  dP = P - ctr;
  vec2  Q  = vec2(cs*dP.x + sn*dP.y, -sn*dP.x + cs*dP.y);
  float diag = ceil(sqrt(dot(u_dims, u_dims)));
  float A = -0.5*diag + 0.5*cell;
  float kx0 = floor((Q.x - A)/cell + 0.5), ky0 = floor((Q.y - A)/cell + 0.5);
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
      float r = sqrt(cov) * 0.71;
      if(r*cell <= 0.2) continue;
      res *= mix(vec3(1.0), inkCol, aaMask(dotSDF(cc, r, u_shape)));
    }
  }
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
  // mono: paper + single ink screen (verified pixel-identical to the CPU op)
  float ang  = radians(u_angle);
  float cs   = cos(ang), sn = sin(ang);
  vec2  dP   = P - ctr;
  vec2  Q    = vec2(cs*dP.x + sn*dP.y, -sn*dP.x + cs*dP.y);    // into the rotated grid frame
  float diag = ceil(sqrt(dot(u_dims, u_dims)));
  float A    = -0.5*diag + 0.5*cell;                          // first cell-centre coord (CPU -diag/2 phase)
  float kx0  = floor((Q.x - A)/cell + 0.5);
  float ky0  = floor((Q.y - A)/cell + 0.5);
  float ink  = 0.0;
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
      float r = sqrt(cov) * 0.71;                              // (cell/2 * 1.42)/cell, cell-fraction
      if(r*cell <= 0.2) continue;                              // CPU drawDot skip threshold
      ink = max(ink, aaMask(dotSDF(cc, r, u_shape)));
    }
  }
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
};
