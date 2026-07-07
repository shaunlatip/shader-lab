// BG Lab GL passes — ordered dither. Moved verbatim from shaders.ts.

import { ditherBnOffset, pb, pn, ps } from "../../cpu/util";
import { type GpuPass, f, loc } from "../common";

// ---------------------------------------------------------------- ordered dither (diffusion modes bridge to CPU)
export const dither: GpuPass = {
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
// u_bnOff rotates the byte rank (animated dither) — integer-valued float,
// v + u_bnOff < 512 so the mod is exact in f32. Matches CPU's (byte+off)&255.
uniform float u_bnOff;
float bnoise(ivec2 cell){
  float v = floor(texelFetch(u_bn, ivec2(cell.x & 127, cell.y & 127), 0).r*255.0 + 0.5);
  v = mod(v + u_bnOff, 256.0);
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
  setUniforms: (gl, prog, p, u, t) => {
    const types: Record<string, number> = { bayer2: 0, bayer4: 1, bayer8: 2, blueNoise: 3, stripes: 4, crossStripe: 5 };
    gl.uniform1i(loc(gl, prog, "u_type"), types[ps(p, "type", "bayer4")] ?? 1);
    gl.uniform1f(loc(gl, prog, "u_levels"), Math.max(2, Math.round(pn(p, "levels", 3))));
    gl.uniform1f(loc(gl, prog, "u_scale"), Math.max(1, Math.round(pn(p, "scale", 2) * u)));
    gl.uniform1f(loc(gl, prog, "u_mono"), pb(p, "mono", false) ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_pixelate"), Math.max(0, Math.round(pn(p, "pixelate", 0) * u)));
    gl.uniform1f(loc(gl, prog, "u_bnOff"), ditherBnOffset(p, t));
  },
};
