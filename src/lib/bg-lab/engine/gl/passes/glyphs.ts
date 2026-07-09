// BG Lab GL passes — shared glyph-family pass (ascii/blockChars/crosshatch/
// diagonal/diamond/lines/mixed/glyphDots). Moved verbatim from shaders.ts.

import type { ParamValue } from "../../../types";
import { hexRGB, pb, pn, ps } from "../../cpu/util";
import { buildGlyphAtlas } from "../glyphAtlas";
import { type GpuPass, col, f, loc } from "../common";

// ---------------------------------------------------------------- glyphs (ascii/blockChars/mixed/crosshatch/diagonal/diamond/lines/glyphDots)
// GPU accelerator for the shared CPU `renderGlyph` (cpu/converters.ts) — ONE
// shader for all 8 glyph-family EffectTypes (they differ only by catalog
// defaults: cell size, glyph ramp, colorMode, sizeByBrightness). Exotic param
// modes stay on the CPU bridge (see glEngine.shouldBridge glyph gating):
// background transparent/blurred, non-normal blendMode, dotGrid, randomize.
//
// Lattice mirrors renderGlyph EXACTLY: cols=max(1,round((W/cell)*density)),
// rows=max(1,round((H/cell)*density)), cw=W/cols, ch=H/rows (floats). Cell
// index from an output pixel: cx=floor(x/cw) clamped [0,cols-1], likewise cy.
//
// Per-cell source stats: the CPU samples cols×rows via a Skia-filtered
// drawImage downscale (sampleGrid) — not shader-reproducible. This pass
// approximates it with a fixed 4×4 box average of NEAREST texel reads spread
// evenly inside the cell (K=4 constant, matching the task's box-average
// tier — same "documented approximation" class as the blur family's gaussian
// shape divergence). Consequence: per-cell luma can differ slightly from the
// CPU's Skia-filtered value, so a boundary cell may pick an adjacent ramp
// glyph — a discrete one-step flip, not a continuous parity gap.
//
// Edge emphasis needs each of the 4 neighbour cells' averaged luma too (the
// CPU's lumA[] is precomputed over the whole grid before the edge pass runs);
// here every neighbour's 4×4 average is recomputed on demand — 5 cells × 16
// taps = 80 taps worst case, but ONLY when edgeEmphasis>0 (u_edgeAmt<=0 skips
// the whole neighbour block, matching the CPU's `if (edgeAmt<=0) return 0`).
//
// Glyph selection: ramp mode picks idx=clamp(floor((1-amt)*(N-1)),0,N-1) from
// the atlas (N = glyph count); sizeByBrightness mode samples atlas glyph 0
// scaled by 1/sqrt(amt) about the cell centre (so the glyph shrinks as amt
// falls) and discards outside the glyph's own cell footprint, matching the
// CPU's `ctx.font = fontPx*sqrt(amt)` shrink. Coverage thins low-ink cells to
// background-only, same threshold as the CPU (`amt < 1-coverage`).
//
// Atlas: built by glyphAtlas.ts at the SAME fontPx the screen would use
// (fontPx = max(1,min(cw,ch)*1.15*fontScale)), quantized to 0.5px
// (fontPxQ=round(fontPx*2)/2) so the atlas cache — keyed by glyphs+fontPxQ —
// doesn't rebuild on every sub-pixel resize jitter. Atlas is addressed in
// top-left-origin UV (createAssetTextureRGBA does NOT flip on upload); this
// shader flips its OWN y addressing when computing atlas UV, same convention
// every pass here uses for u_tex (1.0 - v_uv.y-style flips).
//
// Rasterization: the atlas IS canvas fillText output (same font string as the
// CPU), so glyph shapes are pixel-identical where both land on the same
// sub-pixel phase — but the CPU stamps at fractional per-cell centres while
// the atlas is a fixed pre-rendered grid sampled by NEAREST, so edges of
// glyph strokes will not phase-align 1:1. Expect a statistical parity tier on
// RASTERIZATION (small mean, possibly larger max at glyph edges), while
// glyph SELECTION should match almost everywhere (see box-average note above).
const GLYPH_K = 4; // box-average taps per axis inside a cell

// Auto contrast (UX param, default-on): the CPU stretches the 2nd–98th
// percentile of the post-contrast/brightness cell-luma grid to 0..1 BEFORE the
// edge pass reads it. A fragment pass can't see the whole grid, so the stretch
// runs as a GpuPass.pre reduction: render every cell's luma into a cols×rows
// temp (16-bit packed across r/g — 8 bits posterizes the percentile), read the
// tiny grid back, histogram-walk to the percentiles in JS, and hand lo/span to
// the main frag as uniforms. Cell values come from the same GLYPH_K box
// average the main pass uses, so the stretch sees exactly what the shader
// sees (the CPU's Skia-downscale divergence stays in its documented class).
const CELL_LUMA_FRAG = f(`uniform vec2 u_srcDims; uniform float u_cw; uniform float u_ch;
uniform float u_contrast; uniform float u_brightness;

vec3 srcAt(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_srcDims-1.0);
  return texture(u_tex, vec2((c.x+0.5)/u_srcDims.x, 1.0-(c.y+0.5)/u_srcDims.y)).rgb;
}

void main(){
  // one destination pixel per cell; u_dims is the cols×rows lattice
  vec2 cell = floor(vec2(v_uv.x, 1.0 - v_uv.y) * u_dims);
  float x0 = cell.x*u_cw, y0 = cell.y*u_ch;
  vec3 acc = vec3(0.0);
  for(int j=0;j<${GLYPH_K};j++){
    for(int i=0;i<${GLYPH_K};i++){
      float fx = (float(i)+0.5)/float(${GLYPH_K});
      float fy = (float(j)+0.5)/float(${GLYPH_K});
      acc += srcAt(floor(vec2(x0+fx*u_cw, y0+fy*u_ch)));
    }
  }
  vec3 avg = acc/float(${GLYPH_K}*${GLYPH_K});
  float l = clamp(pow(clamp(luma601(avg),0.0,1.0), u_contrast) + u_brightness, 0.0, 1.0);
  float q = floor(l * 65535.0 + 0.5);
  float hi = floor(q / 256.0);
  o = vec4(hi/255.0, (q - hi*256.0)/255.0, 0.0, 1.0);
}`);

const GLYPH_FRAG = f(`uniform float u_cols; uniform float u_rows; uniform float u_cw; uniform float u_ch;
uniform float u_autoOn; uniform float u_autoLo; uniform float u_autoSpan;
uniform float u_contrast; uniform float u_brightness; uniform float u_edgeAmt; uniform float u_coverage;
uniform float u_brightDense; uniform float u_invert; uniform float u_sizeBy; uniform float u_colorSource;
uniform vec3 u_ink; uniform vec3 u_paper; uniform int u_bgMode; // 0 paper, 1 original
uniform float u_charOpacity; uniform float u_atlasCols; uniform float u_atlasRows; uniform float u_atlasN;
uniform float u_atlasCellPxW; uniform float u_atlasCellPxH; uniform float u_fontPx; uniform float u_fontPxAtlas;
uniform sampler2D u_atlas;

vec3 srcAt(vec2 idx){
  vec2 c = clamp(idx, vec2(0.0), u_dims-1.0);
  return texture(u_tex, vec2((c.x+0.5)/u_dims.x, 1.0-(c.y+0.5)/u_dims.y)).rgb;
}

// K×K box average of NEAREST source reads spread evenly inside cell (cx,cy)
// (approximates the CPU's Skia-filtered cols×rows downscale — see block comment).
vec3 cellAvg(float cx, float cy){
  float x0 = cx*u_cw, y0 = cy*u_ch;
  vec3 acc = vec3(0.0);
  for(int j=0;j<${GLYPH_K};j++){
    for(int i=0;i<${GLYPH_K};i++){
      float fx = (float(i)+0.5)/float(${GLYPH_K});
      float fy = (float(j)+0.5)/float(${GLYPH_K});
      vec2 idx = floor(vec2(x0+fx*u_cw, y0+fy*u_ch));
      acc += srcAt(idx);
    }
  }
  return acc/float(${GLYPH_K}*${GLYPH_K});
}

// Post brightness/contrast luma for one cell — same formula as the CPU's
// lumA[] precompute (avg is already 0..1, matching texture() sample range).
// The autoContrast stretch applies HERE (not only to the centre cell) because
// the CPU stretches lumA[] before the edge pass reads its neighbours.
float cellLuma(float cx, float cy){
  vec3 avg = cellAvg(clamp(cx,0.0,u_cols-1.0), clamp(cy,0.0,u_rows-1.0));
  float l = clamp(pow(clamp(luma601(avg),0.0,1.0), u_contrast) + u_brightness, 0.0, 1.0);
  if(u_autoOn > 0.5) l = clamp((l - u_autoLo)/u_autoSpan, 0.0, 1.0);
  return l;
}

float edgeAt(float cx, float cy){
  if(u_edgeAmt<=0.0) return 0.0;
  float lL = cellLuma(cx-1.0, cy);
  float lR = cellLuma(cx+1.0, cy);
  float lT = cellLuma(cx, cy-1.0);
  float lB = cellLuma(cx, cy+1.0);
  float gx = abs(lL-lR);
  float gy = abs(lT-lB);
  return clamp(gx+gy, 0.0, 1.0);
}

void main(){
  vec2 P = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;   // canvas px, top-left origin
  float cx = clamp(floor(P.x/u_cw), 0.0, u_cols-1.0);
  float cy = clamp(floor(P.y/u_ch), 0.0, u_rows-1.0);

  vec3 avg = cellAvg(cx, cy);
  float lum0 = cellLuma(cx, cy);
  float lum = clamp(lum0 - edgeAt(cx,cy)*u_edgeAmt, 0.0, 1.0);
  float amt = u_brightDense > 0.5 ? lum : 1.0 - lum;
  if(u_invert > 0.5) amt = 1.0 - amt;

  // background layer first
  vec3 bg = u_bgMode == 1 ? texture(u_tex, v_uv).rgb : u_paper;
  vec3 outc = bg;

  if(amt >= 1.0 - u_coverage){
    // position within the cell, [0,1)
    float lx = P.x - cx*u_cw;
    float ly = P.y - cy*u_ch;

    float atlasAlpha = 0.0;
    vec3 glyphColor = u_colorSource > 0.5 ? avg : u_ink;

    if(u_sizeBy > 0.5){
      if(amt > 0.02){
        // CPU draws glyph 0 at fontPx*sqrt(amt) — SMALLER for lower amt. To
        // shrink a fixed-size atlas glyph, EXPAND the lookup coords by 1/s
        // (magnified lookup = shrunk stamp): atlas px = (lx - cellCentre)/s
        // + atlasCentre, s = sqrt(amt). (The inverse — contracting the lookup
        // — blows the dot up to cover the whole cell.)
        float s = sqrt(max(amt, 0.0001));
        float ax = (lx - u_cw*0.5)/s + u_atlasCellPxW*0.5;
        float ay = (ly - u_ch*0.5)/s + u_atlasCellPxH*0.5;
        if(ax >= 0.0 && ax < u_atlasCellPxW && ay >= 0.0 && ay < u_atlasCellPxH){
          vec2 auv = vec2(ax/(u_atlasCols*u_atlasCellPxW), ay/(u_atlasRows*u_atlasCellPxH));
          atlasAlpha = texture(u_atlas, auv).a;
        }
      }
    } else {
      float idxf = clamp(floor((1.0-amt)*(u_atlasN-1.0)), 0.0, u_atlasN-1.0);
      float gx = mod(idxf, u_atlasCols);
      float gy = floor(idxf/u_atlasCols);
      // map cell-local px into this glyph's atlas cell (same font size both sides)
      float ax = (lx - u_cw*0.5) + u_atlasCellPxW*0.5;
      float ay = (ly - u_ch*0.5) + u_atlasCellPxH*0.5;
      if(ax >= 0.0 && ax < u_atlasCellPxW && ay >= 0.0 && ay < u_atlasCellPxH){
        vec2 auv = vec2((gx*u_atlasCellPxW+ax)/(u_atlasCols*u_atlasCellPxW), (gy*u_atlasCellPxH+ay)/(u_atlasRows*u_atlasCellPxH));
        atlasAlpha = texture(u_atlas, auv).a;
      }
    }

    outc = mix(bg, glyphColor, atlasAlpha * u_charOpacity);
  }

  o = vec4(outc, 1.0);
}`);

const GLYPH_CHAR_SETS: Record<string, string> = {
  standard: "@#S08Xx+=-;:,. ",
  detailed: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  minimal: "@+. ",
};
const glyphListFor = (p: Record<string, ParamValue>): string[] => {
  const charSet = ps(p, "charSet", "custom");
  const glyphStr = (charSet !== "custom" && GLYPH_CHAR_SETS[charSet]) || ps(p, "glyphs", "@#S08Xx+=-;:,. ") || " ";
  return Array.from(glyphStr);
};
// Same lattice math as setUniforms below (cols/rows/cw/ch/fontPx) — kept in
// sync so the atlas built here always matches what setUniforms expects.
const glyphFontPxQ = (p: Record<string, ParamValue>, u: number, dims: { w: number; h: number }): number => {
  const density = Math.min(1.8, Math.max(0.5, pn(p, "density", 1)));
  const cell = Math.max(4, pn(p, "cell", 12) * u);
  const cols = Math.max(1, Math.round((dims.w / cell) * density));
  const rows = Math.max(1, Math.round((dims.h / cell) * density));
  const cw = dims.w / cols;
  const ch = dims.h / rows;
  const fontScale = Math.min(2, Math.max(0.3, pn(p, "fontScale", 1)));
  const fontPx = Math.max(1, Math.min(cw, ch) * 1.15 * fontScale);
  return Math.round(fontPx * 2) / 2;
};

/** Shared lattice math (mirrors renderGlyph exactly — see block comment). */
const glyphLattice = (p: Record<string, ParamValue>, u: number, dims: { w: number; h: number }) => {
  const density = Math.min(1.8, Math.max(0.5, pn(p, "density", 1)));
  const cell = Math.max(4, pn(p, "cell", 12) * u);
  const cols = Math.max(1, Math.round((dims.w / cell) * density));
  const rows = Math.max(1, Math.round((dims.h / cell) * density));
  return { cols, rows, cw: dims.w / cols, ch: dims.h / rows };
};

export const glyphs: GpuPass = {
  frag: GLYPH_FRAG,
  frags: [CELL_LUMA_FRAG], // aux pre-pass frag — dev self-check compiles it too
  pre: (ctx, p, u, t, dims): Record<string, number> => {
    if (!pb(p, "autoContrast", false)) return {};
    const { cols, rows, cw, ch } = glyphLattice(p, u, dims);
    const contrast = pn(p, "contrast", 1);
    const brightness = Math.min(1, Math.max(-1, pn(p, "brightness", 0)));
    const dst = ctx.temp("glyphCellLuma", cols, rows);
    ctx.run(CELL_LUMA_FRAG, dst, [{ name: "u_tex", tex: ctx.input.tex }], (gl, pr) => {
      gl.uniform2f(loc(gl, pr, "u_srcDims"), dims.w, dims.h);
      gl.uniform1f(loc(gl, pr, "u_cw"), cw);
      gl.uniform1f(loc(gl, pr, "u_ch"), ch);
      gl.uniform1f(loc(gl, pr, "u_contrast"), contrast);
      gl.uniform1f(loc(gl, pr, "u_brightness"), brightness);
    });
    const px = ctx.read(dst);
    // Histogram walk over the 16-bit quantized lumas — same ranks the CPU's
    // sort picks: lo = sorted[floor((n-1)*0.02)], hi = sorted[floor((n-1)*0.98)].
    const n = cols * rows;
    const hist = new Uint32Array(65536);
    for (let i = 0; i < n; i++) hist[px[i * 4] * 256 + px[i * 4 + 1]]++;
    const rank = (k: number): number => {
      let cum = 0;
      for (let b = 0; b < 65536; b++) {
        cum += hist[b];
        if (cum > k) return b / 65535;
      }
      return 1;
    };
    const lo = rank(Math.floor((n - 1) * 0.02));
    const hi = rank(Math.floor((n - 1) * 0.98));
    const span = hi - lo;
    if (span <= 1e-4) return {}; // CPU: no stretch when the grid is near-flat
    return { autoLo: lo, autoSpan: span };
  },
  dynamicSamplers: (p, u, dims) => {
    const glyphList = glyphListFor(p);
    const fontPxQ = glyphFontPxQ(p, u, dims);
    return [
      {
        name: "u_atlas",
        sig: glyphList.join("") + "|" + fontPxQ,
        build: () => buildGlyphAtlas(glyphList, fontPxQ).canvas,
      },
    ];
  },
  setUniforms: (gl, prog, p, u, t, dims, pre) => {
    const { cols, rows, cw, ch } = glyphLattice(p, u, dims);
    const contrast = pn(p, "contrast", 1);
    const brightness = Math.min(1, Math.max(-1, pn(p, "brightness", 0)));
    const edgeAmt = Math.min(1, Math.max(0, pn(p, "edgeEmphasis", 0)));
    const coverage = Math.min(1, Math.max(0, pn(p, "coverage", 1)));
    const invert = pb(p, "invert", false);
    const sizeBy = pb(p, "sizeByBrightness", false);
    const colorMode = ps(p, "colorMode", "ink");
    const ink = ps(p, "ink", "#e9e4d8");
    const paper = ps(p, "paper", "#16140f");
    const [ir, ig, ib] = hexRGB(ink);
    const [pr, pg, pbb] = hexRGB(paper);
    const luma601n = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const brightDense = luma601n(ir, ig, ib) >= luma601n(pr, pg, pbb);
    const background = ps(p, "background", "paper"); // paper | original (blurred/transparent bridge to CPU)
    const charOpacity = Math.min(1, Math.max(0, pn(p, "charOpacity", 1)));

    const glyphList = glyphListFor(p);
    const N = glyphList.length;
    const atlasCols = Math.ceil(Math.sqrt(Math.max(1, N)));
    const atlasRows = Math.ceil(Math.max(1, N) / atlasCols);
    const fontPxQ = glyphFontPxQ(p, u, dims);
    const atlasCellPx = Math.ceil(fontPxQ * 1.4);

    gl.uniform1f(loc(gl, prog, "u_cols"), cols);
    gl.uniform1f(loc(gl, prog, "u_rows"), rows);
    gl.uniform1f(loc(gl, prog, "u_cw"), cw);
    gl.uniform1f(loc(gl, prog, "u_ch"), ch);
    // autoContrast stretch from the pre-pass; absent (off / near-flat grid) → no-op
    gl.uniform1f(loc(gl, prog, "u_autoOn"), pre && pre.autoSpan !== undefined ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_autoLo"), pre?.autoLo ?? 0);
    gl.uniform1f(loc(gl, prog, "u_autoSpan"), pre?.autoSpan ?? 1);
    gl.uniform1f(loc(gl, prog, "u_contrast"), contrast);
    gl.uniform1f(loc(gl, prog, "u_brightness"), brightness);
    gl.uniform1f(loc(gl, prog, "u_edgeAmt"), edgeAmt);
    gl.uniform1f(loc(gl, prog, "u_coverage"), coverage);
    gl.uniform1f(loc(gl, prog, "u_brightDense"), brightDense ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_invert"), invert ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_sizeBy"), sizeBy ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_colorSource"), colorMode === "source" ? 1 : 0);
    gl.uniform3fv(loc(gl, prog, "u_ink"), col(p, "ink", "#e9e4d8"));
    gl.uniform3fv(loc(gl, prog, "u_paper"), col(p, "paper", "#16140f"));
    gl.uniform1i(loc(gl, prog, "u_bgMode"), background === "original" ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_charOpacity"), charOpacity);
    gl.uniform1f(loc(gl, prog, "u_atlasCols"), atlasCols);
    gl.uniform1f(loc(gl, prog, "u_atlasRows"), atlasRows);
    gl.uniform1f(loc(gl, prog, "u_atlasN"), Math.max(1, N));
    gl.uniform1f(loc(gl, prog, "u_atlasCellPxW"), atlasCellPx);
    gl.uniform1f(loc(gl, prog, "u_atlasCellPxH"), atlasCellPx);
    gl.uniform1f(loc(gl, prog, "u_fontPx"), fontPxQ);
    gl.uniform1f(loc(gl, prog, "u_fontPxAtlas"), fontPxQ);
  },
};
