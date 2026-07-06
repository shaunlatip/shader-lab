// BG Lab GL passes — halftone (mono + CMYK). Moved verbatim from shaders.ts.

import { pb, pn, ps } from "../../cpu/util";
import { type GpuPass, col, f, loc } from "../common";

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
export const halftone: GpuPass = {
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
