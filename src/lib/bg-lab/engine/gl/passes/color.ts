// BG Lab GL passes — color family: grayscale, threshold, posterize, tint,
// adjust, gradientMap. Moved verbatim from shaders.ts.

import { hexRGB, pb, pn, ps, pstops } from "../../cpu/util";
import { type GpuPass, col, f, loc } from "../common";

// ---------------------------------------------------------------- grayscale
export const grayscale: GpuPass = {
  frag: f(`uniform float u_amount;
void main(){ vec4 c=texture(u_tex,v_uv); float l=luma601(c.rgb); o=vec4(mix(c.rgb,vec3(l),u_amount),c.a); }`),
  setUniforms: (gl, prog, p) => gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 1)),
};

// ---------------------------------------------------------------- threshold
export const threshold: GpuPass = {
  frag: f(`uniform float u_level; uniform float u_amount;
void main(){ vec4 c=texture(u_tex,v_uv); float v=luma601(c.rgb)>=u_level?1.0:0.0; o=vec4(mix(c.rgb,vec3(v),u_amount),c.a); }`),
  setUniforms: (gl, prog, p) => {
    gl.uniform1f(loc(gl, prog, "u_level"), pn(p, "level", 0.5));
    gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 1));
  },
};

// ---------------------------------------------------------------- posterize
export const posterize: GpuPass = {
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
export const tint: GpuPass = {
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

// ---------------------------------------------------------------- adjust
export const adjust: GpuPass = {
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

// ---------------------------------------------------------------- gradient map
// Mirrors cpu/ops.ts gradientMap: an 8-bit-quantized LUT built from SORTED
// stops (segment search: first s where t>=stop[s].t && t<=stop[s+1].t, default
// a=first/b=last), keyed by Rec.709 luma (matches CPU `luma`, NOT luma601).
// Stops are passed as fixed-size uniform arrays (max 8; more bridges to CPU —
// see glEngine.shouldBridge). u_nstops===0 (fewer than 2 stops) passes through,
// matching the CPU op's early return.
export const gradientMap: GpuPass = {
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
