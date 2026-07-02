# Effects Lab — shader research inventory + implementation spec

**Status:** This is a *coverage-complete research inventory* of techniques from the sources below,
plus a *scoped implementation spec*. It is NOT "drop-in code." Every code block is tagged:

- `// COMPILING` — a complete WebGL2 (`#version 300 es`) shader or real TS, intended to compile as written (modulo the uniforms the engine already wires via `setCommon`/`setUniforms`).
- `// SPEC` — illustrative pseudo-GLSL / algorithm outline. Names a citation; must be authored into a compiling shader before use.

Coverage (Section 0) is complete vs the sources. Implementation-readiness is **per-op**: an op is ready
only when it has a `COMPILING` shader **and** its engine prerequisites (Section 1) are met.

**Sources** (techniques extracted; GLSL adapted, not copied verbatim):
- Maxime Heckel — [Shades of Halftone](https://blog.maximeheckel.com/posts/shades-of-halftone/),
  [Dithering](https://blog.maximeheckel.com/posts/the-art-of-dithering-and-retro-shading-web/),
  [Painterly Shaders](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/),
  [Moebius](https://blog.maximeheckel.com/posts/moebius-style-post-processing/),
  [Refraction & Dispersion](https://blog.maximeheckel.com/posts/refraction-dispersion-and-other-shader-light-effects/),
  [Post-Processing as a Creative Medium](https://blog.maximeheckel.com/posts/post-processing-as-a-creative-medium/)
- [Book of Shaders ch.9/10/12/13](https://thebookofshaders.com/); [iquilezles 2D SDFs](https://iquilezles.org/articles/distfunctions2d/), [palettes](https://iquilezles.org/articles/palettes/), [filterable procedurals](https://iquilezles.org/articles/filterableprocedurals/)
- Kyprianidis & Döllner, [Anisotropic Kuwahara Filtering on the GPU](https://www.kyprianidis.com/p/gpupro/) (GPU Pro, 2010) — the canonical anisotropic Kuwahara
- [LearnOpenGL PBR Bloom](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom), [RasterGrid separable gaussian](https://www.rastergrid.com/blog/2010/09/efficient-gaussian-blur-with-linear-sampling/), [Wronski golden-ratio blue noise](https://bartwronski.com/2016/10/30/dithering-part-two-golden-ratio-sequence-blue-noise-and-highpass-and-remap/)

---

## Architecture (verified against current code)

- Context: **WebGL2**, `glContext.ts:41-49`. Derivatives (`fwidth`) are core in GLSL ES 3.00 — available.
- Intermediate textures: **RGBA8 / `UNSIGNED_BYTE`**, `LINEAR`, `CLAMP_TO_EDGE` (`glContext.ts:103-117`). **No float RTs** (`EXT_color_buffer_float` not requested).
- `GLContext.pass()` (`glContext.ts:129-152`) **can bind N read samplers** — the loop already supports it. But `glEngine.ts:121` only ever passes `[{name:"u_tex"}]`, so no op can currently bind a second texture (blue-noise/atlas) without an engine change.
- `glEngine` holds exactly **two same-size ping-pong FBOs** `a`/`b` (`glEngine.ts:51-60`). Same-size 2-pass chains (separable blur) are possible; **arbitrary-size mip pyramids are not** without a new RT pool.
- Bridged (CPU) ops roundtrip through a 2D canvas at 8-bit (`glEngine.ts:107-117`) — this **destroys any HDR/linear-throughput** across a bridge boundary. So linear light must be **per-op** (decode/encode inside one shader), not a pipeline-wide float buffer, unless Section 1 F6 lands.
- **Export runs the CPU engine.** `exportStill` instantiates `cpu()` (`useExport.ts:71`); PNG/JPG export always uses the **CPU ops**, never the GL shaders (video/clip export does use GL). **The CPU op is therefore the source of truth for still export.** A GPU-only op makes export diverge from preview. **Rule for this plan:** every op keeps a **CPU implementation at param parity** (GL is the realtime/preview accelerator) — OR we separately switch `exportStill` to the GL engine (its own decision, see §1 F0).
- Base draw: **both engines composite the source on a 2D scratch canvas, then upload** (`glEngine.ts:82-101`, `cpuEngine.ts:27-41`). A generated pattern can be drawn on that same 2D scratch on the **CPU** with zero shader work (the v1 path) — it does not require a GL generator.
- `SourceState` allows only `image | video | solid` (`types.ts:69-76`); `EngineSource` likewise (`engine/types.ts:7-11`). A pattern source needs new entries in both + schema + export + UI.
- `MAX_TEXTURE_SIZE` is checked at `glEngine.ts:53-55` and is the real limiter on 40MP export (not AA math).

---

## 0. Coverage checklist (audit nothing is missed)

**Halftone — 14:** grid · dot SDF · pixelation-align · staggered · luma→radius · fwidth AA · inverted dots/squares · ring · rotation+moiré · RGB→CMYK · per-channel subtractive · break-grid overflow · gooey · displaced/animated.
**Dithering — 8 + C4:** white-noise · Bayer 2/4/8 · blue-noise texture · quantization · luma · per-channel · error-diffusion (CPU) · harness · + stylized 8×8 matrices.
**Kuwahara — 7:** 4-sector · Papari 8-sector · Gaussian weight · polynomial weight · structure tensor · anisotropic · tone.
**Edge/Moebius (photo subset) — 4 + DoG:** Sobel-on-luma · wiggle · crosshatch bands · raster dots · + DoG/XDoG.
**Dispersion (2D subset) — 4:** per-channel offset · multi-sample loop · sat() · rygcbv.
**Creative-medium — 11:** pixelate · receipt · ASCII atlas · SDF cells · dither matrices · LED panel · crochet · lego · fluted/frosted glass · depixelation · mouse-trail.
**Pattern generator — 12:** dot grid · line grid · checker · stripes · rings · iso lattice · hex · brick · truchet · voronoi · moiré · fbm.
**Cross-cutting — 6:** per-op linear · dual-filter bloom · separable gaussian · blue-noise+golden-ratio · luminance grain · analytic AA.

---

## 1. Engine foundations (gating prerequisites — corrected scope)

These were under-scoped in the prior draft. Effort reflects the real engine.

| F | Foundation | Why / what it gates | Real scope | Effort |
|---|---|---|---|---|
| **F0** | **Op parity policy / export path** | every GPU op must match on still export (CPU). | Decide per op: (a) **CPU + GL parity** (default — GL accelerates preview, CPU is export truth) OR (b) switch `exportStill` (`useExport.ts:71`) to the GL engine. Until (b), **no GPU-only ops.** | **S (policy) / M (if switching export to GL)** |
| **F1** | **Per-op linear light** | Correct averaging in blur/halftone/gradient/dither. **8-bit safe**: decode sRGB→linear at top of the op, encode back at end — no float RT. Does NOT give cross-op HDR (a bridge zeroes it). | add `toLin/toSRGB` to the GLSL prelude; call inside each averaging op | **S** |
| **F2** | **GLSL prelude include** | `fwidth` AA idiom, `luma`, `rot`, `toLin/toSRGB`, hashes, palette. | inject the prelude **after** the `#version 300 es` + `precision` header (it MUST NOT precede `#version`); cleanest = extend a shared `HEADER` constant in `shaders.ts` and build each `frag` as `HEADER + body` | **S** |
| **F3** | **SDF library include** | crisp dots/grids/glyph shapes. | vendor iq 2D SDFs into the F2 prelude/HEADER | **S** |
| **F4** | **Multi-sampler op wiring** | **gates blue-noise + ASCII atlas + any 2-input op.** `pass()` already binds N reads; `glEngine` doesn't expose it. | extend `GpuPass` with `samplers?: {name, key}[]`; add an asset-texture loader/cache that returns a **sampler-only** texture (`NEAREST`/`REPEAT`, no FBO — distinct from `createTexture()`'s `LINEAR`/`CLAMP` render targets); `glEngine` binds them after `u_tex` | **M** |
| **F5a** | **Multi-pass same-size op API** | **gates separable blur, DoG/XDoG, structure-tensor smoothing.** The 2 ping-pong FBOs already allow same-size 2-pass; this just exposes an op-internal N-pass API. | let a `GpuPass` declare an internal pass list run over same-size pooled RTs; return final to the chain | **M** |
| **F5b** | **Arbitrary-size RT pool / mip pyramid** | **gates dual-filter bloom + anisotropic-Kuwahara downscale only.** | `GLContext.acquireRT(w,h)`/`releaseRT` at arbitrary sizes + compositing | **M–L** |
| **F6** | **Float RTs (optional, deferred)** | true HDR-linear throughput for physically-correct bloom only. | request `EXT_color_buffer_float`; `RGBA16F` in `createTexture`; FBO-completeness fallback to 8-bit | **L (defer)** |
| **F7** | **Pattern source plumbing** | the new Source. v1 draws on the existing 2D scratch base — **CPU, no shader**. | `SourceState.mode:"pattern"` + `pattern:PatternState`; `EngineSource{kind:"pattern"}`; base-draw branch in both engines calls a CPU `drawPattern()`; `useImageSource`, `schema`, `ExportBar`/`Stage`/`CropRotate`/`useExport` (treat like `solid`), `library.sourceLabel`, new `PatternPanel` | **M** |
| **F8** | **Blue-noise asset** | real blue noise (vs interleaved-gradient). | ship 128² blue-noise PNG; load via F4; bind `NEAREST`+`REPEAT`, sample `gl_FragCoord.xy/128.0` | **S (needs F4)** |

**F1 prelude (COMPILING idioms):**
```glsl
// COMPILING — ADD these to the existing HEADER (shaders.ts:15). HEADER already declares
// #version, precision, v_uv, u_tex, u_texel, u_dims, u_unit, u_time, o, luma601, luma709 —
// do NOT redeclare them. Op bodies are `f(body)` = HEADER + body and declare only their own uniforms.
vec3  toLin(vec3 s){ return pow(s, vec3(2.2)); }       // cheap sRGB→linear
vec3  toSRGB(vec3 l){ return pow(l, vec3(1.0/2.2)); }  // linear→sRGB
mat2  rot(float a){ float s=sin(a), c=cos(a); return mat2(c,-s,s,c); }
float aaMask(float d){ float w = max(fwidth(d), 1e-4); return 1.0 - smoothstep(-w, w, d); }
```

**Decision baked in:** linear stays **per-op** (F1), pattern source is **CPU-drawn on the 2D scratch** (F7).
Float RTs (F6) and a GPU pattern generator are deferred and explicitly optional.

---

## 2. Halftone — GPU single-pass rewrite (all 14 features)

**Today:** CPU bridge (`ops.ts:597-630`), hard fills, CMYK = 4-pass CPU loop. Catalog params: `cell, angle, contrast, dotShape, mode, aa, ink, paper`.

**Parity (F0).** Still export uses the CPU engine, so this is a **dual implementation**: upgrade the CPU `halftone` (`ops.ts:597-680`) AND add a GL pass — **do not drop the CPU bridge**. Both must honor the same params (new shapes/stagger/etc.) or export will diverge from preview.

**CPU↔GL parity contract (single lattice definition).** Pixel-identical preview/export requires both engines to use *one* lattice + sampling definition. The current CPU op anchors its screen at `origin = -diag/2` (`ops.ts:617-621`), which phase-shifts the grid by `mod(diag/2, cell)` vs the shader's center-anchored `fract(gp)`. **Resolution: the CPU upgrade adopts the shader's definition** — rotate about canvas center, lattice = `fract((R·(px-ctr))/cell)`, drop the legacy `-diag/2` phase. Likewise sampling: the shader reads the source at the **cell-center texel**; the CPU upgrade samples the same center (round to texel), and the halftone source read should be **nearest** (GL RTs are `LINEAR`, `glContext.ts:108`) so edge dot sizes match. Treat "rewrite CPU + GL from the same lattice/sampling spec" as one task, not two parallel implementations.

**Radius model (named, per-shape).** The "reaches full ink at `cov=1`" radius is **shape-specific** because each SDF measures distance differently: circle/ring (L2) reach the cell corner at `r=0.7071`, square (L∞) fills the cell at `r=0.5`, diamond (L1) and line reach the corner at `r=1.0`. The shader uses `shapeRMax(shape)` so every shape blackens fully at `cov=1` (a single `0.7071` would under/over-ink the others). The circle default matches the current CPU `ops.ts:626` (`*1.42=√2`). Optional `coverageModel:"area"` (circle) = `r = sqrt(cov/π) ≈ 0.564·sqrt(cov)`, area-accurate only until the circle clips the cell (>~78.5% it under-inks) — a perceptual option, not physically exact.

**Single-pass GPU; all 5 dotShapes.** The GL pass is authored as `frag: f(body)` so `HEADER` (shaders.ts:15) supplies `#version`/precision/`v_uv`/`u_tex`/`u_texel`/`u_dims`/`u_unit`/`u_time`/`o`/`luma601`. The body declares **only its own uniforms** and must implement **all five** existing shapes (`circle|ring|line|square|diamond`, `catalog.ts:292`) or the rewrite regresses `line`/`diamond`.

```glsl
// COMPILING — halftone body, used as `frag: f(body)`. DEPENDS ON F2: rot/toLin/toSRGB must already be in
// HEADER (do not paste before F2). Coords mirror the CPU op (ops.ts:615): canvas-px, top-left origin,
// screen rotated about CENTER — else preview (GL) and export (CPU) grids diverge.
uniform float u_cellCss;   // catalog 'cell'
uniform float u_angle;     // degrees
uniform float u_contrast;
uniform int   u_shape;     // 0 circle 1 ring 2 line 3 square 4 diamond
uniform float u_aa;        // 0/1
uniform vec3  u_ink;       // 0..1  (col() parses hex)
uniform vec3  u_paper;     // 0..1
float dotSDF(vec2 cc, float r, int shape){
  if(shape==3) return max(abs(cc.x), abs(cc.y)) - r;                 // square
  if(shape==4) return (abs(cc.x) + abs(cc.y)) - r;                   // diamond
  if(shape==2) return abs(cc.y) - r*0.5;                             // line (bar; u_angle rotates it)
  if(shape==1){ float d=length(cc); return max(d - r, (r*0.55) - d); } // ring (annulus)
  return length(cc) - r;                                             // circle
}
// per-shape radius reaching full ink at cov=1: square edge ½, diamond/line corner 1, circle/ring corner √½
float shapeRMax(int s){ return s==3 ? 0.5 : (s==4 || s==2) ? 1.0 : 0.7071; }
void main(){
  float cell = max(2.0, u_cellCss * u_unit);
  vec2  px   = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;   // canvas px, top-left origin (CPU + GL y-convention)
  vec2  ctr  = 0.5 * u_dims;
  mat2  R    = rot(radians(u_angle));
  vec2  gp   = (R * (px - ctr)) / cell;               // rotate the screen about its CENTER (parity w/ ops.ts:615)
  vec2  cc   = fract(gp) - 0.5;
  vec2  cpx  = ctr + transpose(R) * ((floor(gp)+0.5)*cell);          // cell center back in canvas px
  vec2  sUv  = clamp(cpx / u_dims, 0.0, 1.0); sUv.y = 1.0 - sUv.y;   // back to GL uv for texture()
  vec3  src  = toLin(texture(u_tex, sUv).rgb);
  float cov  = pow(clamp(1.0 - luma601(src), 0.0, 1.0), u_contrast);   // HEADER luma601; dark ⇒ more ink
  float r    = sqrt(cov) * shapeRMax(u_shape);                         // per-shape → full ink at cov=1 for every shape
  float d    = dotSDF(cc, r, u_shape);
  float w    = u_aa > 0.5 ? max(fwidth(d), 1e-4) : 1e-4;
  float ink  = 1.0 - smoothstep(-w, w, d);
  o = vec4(toSRGB(mix(toLin(u_paper), toLin(u_ink), ink)), 1.0);
}
```
```ts
// COMPILING — setUniforms (uses shaders.ts helpers loc/pn/ps/pb/col). setCommon already wires
// u_dims/u_unit/u_texel/u_time; this maps the catalog keys (catalog.ts:285).
setUniforms: (gl, prog, p, u) => {
  gl.uniform1f(loc(gl,prog,"u_cellCss"),  pn(p,"cell",9));
  gl.uniform1f(loc(gl,prog,"u_angle"),    pn(p,"angle",45));
  gl.uniform1f(loc(gl,prog,"u_contrast"), pn(p,"contrast",1));
  gl.uniform1i(loc(gl,prog,"u_shape"),    ["circle","ring","line","square","diamond"].indexOf(ps(p,"dotShape","circle")));
  gl.uniform1f(loc(gl,prog,"u_aa"),       pb(p,"aa",true)?1:0);
  gl.uniform3fv(loc(gl,prog,"u_ink"),     col(p,"ink","#191512"));
  gl.uniform3fv(loc(gl,prog,"u_paper"),   col(p,"paper","#f1ece4"));
},
```

**CMYK (SPEC — must replace the current non-reference CPU math).** The existing CPU CMYK (`ops.ts:655`) uses `1-R,1-G,1-B` + a separate luma `K` — that is **not** a real separation. Use the reference RGB→CMYK with K extraction (reference §A8), evaluate four rotated screens (C15° M75° Y0° K45°) in one fragment, and recombine **subtractively** by layering inks:
```glsl
// SPEC — CMYK halftone (single fragment; replace CPU + GL together for parity)
vec4 rgb2cmyk(vec3 c){ float k=min(1.0-c.r,min(1.0-c.g,1.0-c.b));
  vec3 cmy = (k<1.0) ? (1.0-c-k)/(1.0-k) : vec3(0.0); return vec4(cmy,k); }
// inkC/M/Y/K = 1 - smoothstep(...) of dotSDF at that channel's coverage + angle, sampled at the channel's cell center.
// layer inks over white paper (subtractive):
vec3 res = vec3(1.0);
res *= mix(vec3(1.0), vec3(0.0,0.68,0.94), inkC);  // cyan ink
res *= mix(vec3(1.0), vec3(0.93,0.0,0.55), inkM);  // magenta
res *= mix(vec3(1.0), vec3(1.0,0.95,0.0),  inkY);  // yellow
res *= mix(vec3(1.0), vec3(0.0),           inkK);  // key/black
```

| # | Feature | Maps to | New? | Note |
|---|---|---|---|---|
| 1-2 | grid + dot SDF | shader engine | upgrade | above |
| 3 | pixelation align | cell-center sample | upgrade | inverse-rotate center (above) |
| 4 | **staggered** | add `stagger:bool` | NEW | `gp.x += 0.5*mod(floor(gp.y),2.0);` |
| 5 | luma→radius | `contrast` | fix | radius model above |
| 6 | **fwidth AA** | `aa` | upgrade | `aaMask` |
| 7 | **inverted dots/squares** | add `invertCells:bool` | NEW | square fill + paper dot |
| 8 | ring | `dotShape:ring` | keep | `max(d, -(d2))` two SDFs |
| 9 | rotation/moiré | `angle` | keep | per-channel angles for CMYK |
| 10-11 | CMYK | `mode:cmyk` | upgrade | 4 screens, angles **C15 M75 Y0 K45**, `out *= 1 - s·dot` per channel, all in one fragment (SPEC — extend the mono shader) |
| 12 | **overflow** | add `overflow:0–2` | NEW | constant `for` loop over a 3×3 (or 5×5) neighborhood, `min` the SDFs; **constant bounds, runtime skip** |
| 13 | **gooey** | add `gooey:0–1` | NEW | `smin` over the neighborhood (iq `smin`) |
| 14 | **displaced/animated** | defer | NEW (defer) | needs a velocity/trail texture → **requires F4 (+ state); Phase 2** |

CMYK and overflow/gooey stay **single-pass GPU** (neighbor reads are in-shader loops, not extra passes). Only #14 needs F4. **Keep the CPU halftone at parity** (export path, F0) — the GL pass is the preview accelerator, not a replacement. **Effort:** L (GL mono+CMYK shader) + M (CPU upgrade to match new params) · S each for stagger/inverted/overflow/gooey.

---

## 3. Dithering — all 8 + stylized matrices

**Today:** `dither` (`type{bayer2,4,8,blueNoise,floydSteinberg}, levels, scale, mono, serpentine`); "blueNoise" is interleaved-gradient noise; FS is CPU.

| ID | Feature | Action | Where |
|---|---|---|---|
| **retro cell** (reference §B) | sample **one source color per cell** before dithering for the retro look. Current GPU `scale` only scales the threshold matrix (`shaders.ts:207`), it doesn't pixelate the source. | add a `floor(uv/cell)*cell` source snap when `pixelate>0` | GPU |
| Bayer | keep | quantize in **linear** (F1); threshold before quantize | GPU |
| **blue-noise** | replace IGN with **F8 texture** | needs **F4 + F8** (engine can't bind a 2nd sampler today) | GPU |
| quantization | `floor(c*(n-1)+0.5)/(n-1)` (have via `levels`) | — | GPU |
| luma/per-channel | `mono` switch | — | GPU |
| error-diffusion | **keep CPU**; add **Atkinson, Sierra, Jarvis** | sequential | CPU |
| **temporal** | golden-ratio offset **only when `animate` is on**; static for stills/export (else previews flicker) | gated | GPU |
| **stylized matrices** | 8×8 `stripes`/`crossStripe` modes (Heckel C4) | — | GPU |

**Effort:** S each, but blue-noise is **blocked on F4+F8**.

---

## 4. Painterly / Kuwahara (NEW `kuwahara`)

**Basic 4-sector is single-pass GPU** with constant loop bounds + runtime radius skip (per Codex):

```glsl
// COMPILING — basic 4-sector Kuwahara, BODY-ONLY (used as `frag: f(body)`).
// HEADER (shaders.ts:15) already declares v_uv/u_tex/u_texel/o + luma601 — do NOT redeclare them.
uniform int  u_radius;  // runtime, <= R_MAX
const int R_MAX = 8;
void sector(int x0,int x1,int y0,int y1, out vec3 mean, out float var){
  vec3 s=vec3(0.0), s2=vec3(0.0); float n=0.0;
  for(int y=-R_MAX;y<=R_MAX;y++) for(int x=-R_MAX;x<=R_MAX;x++){
    if(x<x0||x>x1||y<y0||y>y1) continue;
    if(abs(x)>u_radius||abs(y)>u_radius) continue;
    vec3 c = texture(u_tex, v_uv + vec2(float(x),float(y))*u_texel).rgb;
    s+=c; s2+=c*c; n+=1.0;
  }
  mean = s/max(n,1.0); vec3 v = s2/max(n,1.0)-mean*mean;
  var = dot(v, vec3(0.299,0.587,0.114));
}
void main(){
  vec3 bm,m; float bv,v;
  sector(-R_MAX,0,-R_MAX,0, bm,bv);
  sector(0,R_MAX,-R_MAX,0, m,v); if(v<bv){bv=v;bm=m;}
  sector(-R_MAX,0,0,R_MAX, m,v); if(v<bv){bv=v;bm=m;}
  sector(0,R_MAX,0,R_MAX, m,v); if(v<bv){bv=v;bm=m;}
  o = vec4(bm,1.0);
}
```

**Anisotropic Kuwahara — corrected 3-pass pipeline (SPEC, Kyprianidis 2010):**
1. **Structure tensor** from Sobel: `E=Σ gx², G=Σ gy², F=Σ gx·gy` (sum over RGB). One pass. **`F` is signed and tensor magnitudes vary by image/kernel, so RGB8 packing is fragile** — anisotropic quality effectively **requires F6 (float RTs)**, or a carefully range-mapped signed encode (`F` remapped to [0,1], `E,G` scaled by a known max). Treat float RTs as a prerequisite for the `anisotropic` mode, not optional.
2. **Smooth the tensor** with a separable Gaussian (THE missing step — raw Sobel products are noisy). One pass (or two, H+V) via F5a.
3. **Anisotropic filter** pass. From the smoothed tensor:
   - eigenvalues `λ1,2 = ((E+G) ± sqrt((E−G)² + 4F²)) / 2`
   - dominant **gradient** angle `θ = 0.5·atan(2F, E−G)`; the filter ellipse's **major axis lies along the edge tangent** `θ + π/2`
   - anisotropy `A = (λ1−λ2)/(λ1+λ2)` (0 isotropic … 1 strong edge)
   - ellipse scale (Kyprianidis): along tangent `(α+A)/α`, across `α/(α+A)`, `α≈1`; sample the 8 Papari sectors in this rotated/scaled frame with the **polynomial sector weights**, choose lowest variance.

This is **3–4 passes → requires F5a (tensor smoothing) + F5b (downscale; + F6 floats for the signed tensor).** Do not ship the prior one-liner; cite Kyprianidis 2010 and author the real thing.

Params: `kernelSize 2–12`, `quality{fast(4-sector),smooth(Papari single-pass),anisotropic(F5a+F5b+F6)}`. **Effort:** M (fast/smooth) · L (anisotropic).

---

## 5. Edge / line-art (NEW `lineArt`) — photo subset of Moebius

Heckel's Moebius is depth/normal-based (3D). Photo-applicable subset + DoG:

| ID | Feature | Photo? | Passes |
|---|---|---|---|
| Sobel-on-luma outline | ✅ | single |
| **DoG / XDoG** | ✅ add | **2 blurs + combine → F5a** |
| hand-drawn wiggle | ✅ | single (hash UV displace) |
| crosshatch luma bands | ✅ | single (`mod(coord,8.)`) |
| raster dots | ✅ | single (SDF) |
| depth/normal Sobel, stylized lighting | ❌ 3D-only | **excluded** |

Sobel/wiggle/hatch/raster are single-pass GPU; XDoG needs F5a. Params: `mode{outline,hatch,ink}, thickness, threshold, wiggle, hatchSpacing`. **Effort:** M (outline/hatch now; XDoG after F5a).

---

## 6. Chromatic / dispersion upgrade (`chromatic`)

| ID | Feature | Action |
|---|---|---|
| per-channel offset | radial: `dir = (v_uv-0.5)` | single pass |
| **multi-sample loop** | `samples 1–16`, accumulate slides, `/= N` | single pass |
| sat() | optional saturation | single |
| rygcbv 6-wavelength | optional `quality:high` (6 offsets) | single |

All single-pass GPU. (3D refract/fresnel/specular/backside excluded.) Params: `amount, mode{split,radial}, samples, saturation, quality{normal,high}`. **Effort:** S–M.

```glsl
// SPEC — multi-sample accumulation with the reference per-channel multipliers (1/2/3)
vec3 acc = vec3(0.0);
for (int i = 0; i < N; i++) {
  float slide = float(i) / float(N) * 0.1;
  vec2  dir   = (v_uv - 0.5);                       // radial; or a fixed dir for 'split'
  acc.r += texture(u_tex, v_uv + dir*(u_amount + slide*1.0)).r;
  acc.g += texture(u_tex, v_uv + dir*(u_amount + slide*2.0)).g;
  acc.b += texture(u_tex, v_uv + dir*(u_amount + slide*3.0)).b;
}
acc /= float(N);
// quality:high → expand to 6 offsets via rygcbv (reference §E):
// fwd:  r=R/2; g=G/2; b=B/2; y=(2R+2G-B)/6; c=(2G+2B-R)/6; v=(2B+2R-G)/6
// rev:  R=r+(2v+2y-c)/3; G=g+(2y+2c-v)/3; B=b+(2c+2v-y)/3
```

---

## 7. Creative-medium effects (Heckel C) — split by cost (per Codex)

**Single-pass photo filters (cheap, GPU now):** C1 receipt/bars · C3 SDF cells · C4 dither matrices (→ §3) · **C5 LED panel** (column + RGB sub-pixel stagger + border mask) · **C6 crochet** (rotated ellipses + row offset) · C7 lego-stud-lighting upgrade (2D fake light) · C8 fluted glass (sine distort + fake normal).
**Needs F4 (extra sampler):** C2 ASCII atlas (glyph texture).
**Needs persistent state the engine lacks (defer):** C9 progressive depixelation (animation `progress` only) · **C10 mouse-trail (persistent FBO — defer; engine has no feedback buffer).**
**Have:** C0 pixelate · C7 lego (upgrade only).
**Recommend first:** C1, C8, C7-upgrade (all single-pass). **Effort:** S–M each.

---

## 8. Pattern generator (the new Source) — v1 = CPU on the 2D scratch

**Decision (resolves the prior CPU-vs-GL ambiguity):** v1 generators are **CPU canvas draws** on the existing base scratch (`drawPattern(ctx, dims, pattern, unit)`), invoked from the base-draw branch in both engines exactly where `solid` fills today. Canvas vector ops (`arc`/`fillRect`/`lineTo`) are exact, so 40MP export is **resolution-sharp** with zero shader work and **no `EngineSource`/RT changes beyond F7**. To also stay **resolution-safe**, `PATTERN_CATALOG` enforces a minimum on-screen cell (`cell·unit ≥ ~3px`) and a hard cap on total primitives (≈4M draws) — otherwise a 2px cell at 40MP would issue tens of millions of `arc()`/`fillRect()` calls and stall. A GPU SDF generator (O(1) per pixel, no draw-count cliff) is the later optimization for animated drift, not v1.

**Cache the rendered pattern.** Both engines rebuild the base every render (`glEngine.ts:82`, `cpuEngine.ts:28`), so a static pattern would re-issue all its draws every frame. Render it once to an offscreen bitmap keyed by `(W, H, patternParams)` and `drawImage` that each frame; rebuild only when dims/params change. This makes the per-frame cost O(1) regardless of cell count, so the primitive cap only bounds the one-time build (keep ~4M; expose a lower cap for low-end devices).

**Initial set (CPU, v1):** dot grid · line grid · checker · stripes · concentric rings · iso/triangular lattice.
**Phase 2 (GPU SDF, SPEC):** hex · brick · truchet · voronoi · moiré · fbm — these are **not yet specified** (no compiling impl); marked explicitly as future.

```ts
// COMPILING (TS, CPU) — dot grid + line grid on the 2D base scratch.
// id-based jitter uses an integer-bounded hash (NOT sin(hugeCoord) — float precision).
type PatternParams = {
  cell: number; weight: number; jitter: number; angle: number; stagger: boolean; fg: string; bg: string;
};
function hash2(ix: number, iy: number): number {           // ix,iy are small cell indices
  // Math.imul keeps every multiply in true 32-bit space (plain `*` overflows 2^53 first).
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;            // 0..1
}
// On-screen cell floor: bounds draw count at 40MP (a 2px cell would issue tens of millions of
// arc()/fillRect() calls). PATTERN_CATALOG additionally caps total primitives (~4M) at the caller.
const MIN_CELL_PX = 3;
function drawDotGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternParams, u: number) {
  const cell = Math.max(MIN_CELL_PX, p.cell * u), r = p.weight * cell, jit = p.jitter * cell;
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = p.fg;
  const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
  for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++) {
    const sx = p.stagger && iy % 2 ? 0.5 : 0;               // staggered rows
    const jx = (hash2(ix, iy) - 0.5) * 2 * jit;
    const jy = (hash2(ix + 9973, iy) - 0.5) * 2 * jit;
    ctx.beginPath();
    ctx.arc((ix + sx + 0.5) * cell + jx, (iy + 0.5) * cell + jy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawLineGrid(ctx: CanvasRenderingContext2D, W: number, H: number, p: PatternParams, u: number) {
  const cell = Math.max(MIN_CELL_PX, p.cell * u);
  ctx.fillStyle = p.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = p.fg; ctx.lineWidth = Math.max(1, p.weight * cell);
  ctx.beginPath();
  for (let x = 0; x <= W; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = 0; y <= H; y += cell) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}
```
checker = two-color `fillRect` per `(ix+iy)%2`; stripes = rotated `fillRect` bands (`ctx.rotate(angle)`); rings = stacked `arc` strokes at `r += cell`; iso lattice = dot grid with `ctx.transform(1, 0, 0.5, 0.866, 0, 0)` shear. All exact on canvas.

**GPU SDF version (Phase 2, SPEC)** would use the F2/F3 prelude (`g/id/c` cell setup, `aaMask`, iq SDFs) and the **integer hash on bounded `id`** (not sin of raw coords). Needed only for animated drift / shader composition.

Per-pattern params (`PATTERN_CATALOG`, reuses `ControlSpec` + grouped controls): `type, fg, bg, cell, weight, jitter, angle, stagger`. **Effort:** M (F7 wiring + initial 6 CPU draws).

---

## 9. Cross-cutting quality wins

| Q | Win | Applies to | Prereq | Effort |
|---|---|---|---|---|
| Q1 | per-op linear | blur, halftone, gradientMap, dither | F1 | S |
| Q2 | **dual-filter bloom** | bloom, characterBloom | **F5b (mip pyramid)**; **F6 for true HDR** | L |
| Q3 | separable gaussian | blur | **F5a** (same-size 2-pass) | M |
| Q4 | blue-noise + golden-ratio (gated to animation) | dither, grain | F4+F8 | S |
| Q5 | luminance film grain | grain | — | S |
| Q6 | analytic AA (`aaMask`; `filteredCheckers` for grids) | all thresholded shapes | F2 | S |

**Bloom reality (Codex):** the 2-FBO engine cannot do a 5–7 mip pyramid. Q2 is **blocked on F5b** (and physically-correct HDR bloom on F6). Until then, bloom stays the current single-radius approximation.

---

## 10. Sequencing (corrected — foundations gate the rest)

1. **F0, F1, F2, F3** (parity policy, per-op linear, prelude/HEADER, SDF) — small, unlock AA + correctness + the export-parity rule everywhere.
2. **Halftone CPU upgrade + GL pass** (§2 mono+CMYK+stagger+inverted+overflow+gooey, both engines for export parity) — biggest quality+perf win, no F4/F5 needed.
3. **F7 + Pattern generator v1** (§8 CPU initial-6) — the new Source.
4. **Dither** §3 (gamma, stylized matrices, CPU diffusion variants) + **Q5/Q6** + **Kuwahara fast/smooth** (§4) + **lineArt outline/hatch** (§5) + **dispersion** (§6) — all single-pass / single-sampler, **no F4/F5 needed**.
5. **F4 (+F8)** → blue-noise dither + ASCII atlas (the only step-4-adjacent items that need a second sampler).
6. **F5a** → separable blur, DoG/XDoG, structure-tensor smoothing. **F5b (+F6)** → **dual-filter bloom** + **anisotropic Kuwahara** downscale. **F6** → HDR bloom.
7. Playful patterns (§8 Phase 2 GPU) · displaced halftone (§2 #14) · creative-medium stateful (§7 C9/C10).

## Open specs to author before coding each op (was "known gaps")
- Halftone CMYK recombination + overflow/gooey neighborhood rules → extend the mono shader into a `COMPILING` CMYK shader.
- Anisotropic Kuwahara → author from Kyprianidis 2010 (tensor smoothing, eigen/orientation, Papari weights); 3–4 passes on F5a/F5b/F6.
- DoG/XDoG thresholds; dual-filter bloom 13-tap down / 9-tap up + Karis average → on F5a/F5b/F6.
- CMYK exact conversion + subtractive recomposition (replace CPU `ops.ts:655` too) → §2 SPEC.
- GPU pattern SDFs (hex/truchet/voronoi/moiré/fbm) → Phase 2, currently unspecified.
- F4 sampler-binding API shape + F5a/F5b RT-pool API shapes → design before any op that needs them.
