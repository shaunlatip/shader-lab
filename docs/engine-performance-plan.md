# Shader Lab — engine performance plan

**The** ordered plan for building every remaining planned shader/feature (roadmap §§2–9) with
performance as a first-class constraint. Companion to `effects-lab-handoff.md` (architecture
contract) and `effects-lab-shader-roadmap.md` (per-effect specs — the spec source; this doc decides
*order and shape*, the roadmap decides *math*). Written 2026-07-02 after a full perf review of the
engine + the perf-round-1 fixes.

## Where we are (post perf-round-1, shipped in this repo)

- ✅ **Base-texture cache** (`glEngine.ts`): the composited source lives in a dedicated `baseTex`,
  re-composited + re-uploaded only when source/transform/dims change; per-frame cost for static
  sources is one GPU blit. (Was: full 2D composite + `texImage2D` upload every frame — 60×/sec
  for identical pixels under any animated effect.)
- ✅ **Export yields** (`useExport.ts`): still + clip exports yield a macrotask so the
  spinner/progress actually paint. Still export stays on the CPU engine (F0: CPU is export truth).
- ✅ **sRGB LUT** (`util.ts`): `srgbToLin` is a 256-entry table (inputs are always 8-bit); dither's
  write-back uses an L-entry level table instead of per-pixel `pow`.
- ✅ **Kuwahara smooth**: per-pixel `Float32Array` allocations hoisted; the `(dx,dy)→sector`
  atan2/disc mapping precomputed once per call.
- ✅ **Two GL shader compile bugs fixed** in the ordered-dither pass (duplicate `toLin`/`toSRGB` vs
  the F2 HEADER; invalid `clamp(vec3,float,vec3)` overload). Either one made the pass fail to
  compile — and the Stage fallback **silently demoted the whole session to the CPU engine**.
- F0–F3 foundations are **live**: parity policy documented (CPU = still-export truth), F2 prelude
  (`toLin/toSRGB/rot/aaMask`) + F3 SDFs (`sdCircle/sdBox/sdDiamond/sdRing`) in `HEADER`, GPU
  halftone (mono + CMYK) shipped with the CPU↔GL lattice parity contract.

## Performance doctrine (applies to every item below)

1. **Never re-do work for static inputs.** The base cache is the model: key on inputs, skip the
   recompute, invalidate explicitly. Applies next to: pattern bitmaps, uniform locations, GIF
   palettes.
2. **Bridges are the enemy.** Each bridged op costs a GPU→CPU readback + CPU op + CPU→GPU upload
   *per frame* (~8 MB each way at 1080p, ~30 MB at dpr-2 preview). Every commonly-stacked,
   animatable op should eventually have a GL pass. CPU ops stay — they're export truth (F0) — the
   GL pass is the preview accelerator.
3. **Single-pass > multi-pass > bridge.** Prefer constant loop bounds with runtime skip (the
   4-sector Kuwahara pattern) over multi-pass; take multi-pass only when the math demands it
   (separable blur, bloom pyramid, tensor smoothing).
4. **Failures must be loud in dev.** The two shader bugs shipped because the GL→CPU fallback is
   silent and CPU output looks identical. Rule: `console.warn` on every engine demotion + bridge
   (dev only), and compile every `GL_OPS` shader at startup in dev (see P0.1).
5. **Parity is authored, not hoped for.** One lattice/sampling spec per effect; CPU and GL
   implement the same spec (halftone contract, roadmap §2). Verify visually on GL **and**
   `?engine=cpu` — and remember headless Chromium here has **no WebGL2**: GL verification needs the
   headed browser (`browse --headed`), otherwise you're only ever testing the CPU engine.
6. **8-bit CPU conversions get LUTs.** Canvas pixels are 8-bit; any per-pixel `pow`/transcendental
   on a channel value should be a 256-entry table (done for `srgbToLin`; replicate as ops appear).

## P0 — Make the engine honest + finish the hygiene wins (before new shaders)

Small, ordered, each independently shippable:

1. **Dev-mode shader self-check.** On GL engine construction (dev only), compile every `GL_OPS`
   frag and `console.error` failures. A broken shader must never again hide behind the fallback.
   *(S)*
2. **Observable + recoverable fallback.** `console.warn` on Stage's GL→CPU demotion with the
   thrown error; retry GL on the next source change (currently the demotion is permanent for the
   session — one transient hiccup = slow forever). *(S)*
3. **Uniform-location cache.** `setCommon` calls `getUniformLocation` twice per uniform per pass
   per frame; the `loc()` helper in `shaders.ts` once per uniform per frame. Cache locations in a
   `Map` keyed by program (natural spot: `GLContext.program()` already memoizes per frag source).
   *(S)*
4. **`texSubImage2D` for same-size uploads.** `uploadExternal` re-allocates storage every call;
   sub-image into the existing allocation when dims match (video frames + bridge returns hit this
   every frame). *(S)*
5. **Guard `target.width = W` reassignment** in both engines — assigning canvas dims clears the
   canvas even when the value is unchanged. *(S)*
6. **Persist Stage's animation clock** (`t0` in a ref) so slider drags don't restart animated
   effects. *(S)*
7. **CPU-engine pattern/base bitmap cache** (mirror of the GL base cache, roadmap §8 note): render
   pattern/static base to an offscreen bitmap keyed `(W,H,params)`; `drawImage` per frame. Matters
   once animated stacks run on the CPU engine. *(S–M)*

## Halftone parity gap — FIXED (2026-07-03)

The 107/255 max-delta halftone divergence was **AA**, not sampling: canvas vector fills (Skia
analytic area coverage) vs the shader's `fwidth` smoothstep (~2px ramp) can never agree. Fix per
the roadmap §2 contract: the CPU op was rewritten as a **per-pixel mirror of the GL shader**
(`ops.ts` `buildHtScreen`/`runHtScreen`) and both engines now share one deterministic AA spec —
`aaCov(dPx) = clamp(0.5 − dPx, 0..1)`, a 1px linear area ramp on the SDF in px units. CMYK also
now multiplies ink layers in float and quantises once on both engines.

Harness results (haystack, 800×533): **mono 1.00 max / 0.0009 mean / 0.000% >1; CMYK 1.00 max /
0.0015 mean / 0.000% >1** (configs added to `/dev/parity`). A square+stagger+angle-22 variant
reads 8/255 max on 0.004% of pixels — `floor(Pc+0.5)` texel-choice ties where GPU f32 trig and
CPU f64 trig disagree; GPU trig is implementation-defined, so tie-break exactness is out of
reach in principle. Bounded, rare, accepted. Cost note: the CPU halftone is now O(pixels×9 dots)
(~2–4× slower than the old vector fills) — fine for export (F0 truth), and GL is the preview path.

## P1 — Bridge-killers: GL passes for the heavy bridged ops

Current CPU-only (bridged) ops: blur, bloom, grain, gradientMap, braille, mosaic, lego, lineArt,
kuwahara, crtCurvature, glitch, filmDust, characterBloom. Order by (usage × per-frame cost ×
animation likelihood), single-pass first; each holds CPU parity per F0:

1. **grain** — the most-stacked op and usually `animate:true` (worst bridge case: per-frame
   readback). Single-pass hash-noise shader; gate golden-ratio temporal offset to `animate`
   (roadmap §3) so stills stay static. *(S–M)*
2. **gradientMap** — stops are few; evaluate the ramp analytically in-shader (uniform stop arrays),
   no F4 needed. *(S)*
3. **kuwahara fast + smooth** — roadmap §4 has the COMPILING 4-sector body (constant `R_MAX`
   bounds + runtime skip); Papari 8-sector is the same pattern with sector weights. *(M)*
4. **lineArt outline/hatch/wiggle** — single-pass Sobel + hatch bands (roadmap §5); XDoG waits for
   F5a. *(M)*
5. **crtCurvature** — trivial radial remap. *(S)*
6. **blur, bloom, characterBloom** — **deliberately after F5** (P3): separable gaussian needs the
   same-size 2-pass API; dual-filter bloom needs the RT pool. Don't hand-roll big-kernel
   single-pass blurs — that's slower than the bridge at large radii.
7. **Leave CPU-only by design:** dither diffusion modes (inherently sequential), braille/mosaic/
   lego/glitch/filmDust (draw-call composites, rarely animated, poor shader fits). They bridge;
   that's fine — after items 1–5 a typical animated stack is bridge-free.

**Exit criterion:** default-preset stacks (halftone/dither/grain/kuwahara combos) run zero bridges
on GL at dpr-2 preview.

## P2 — F4 samplers (+F8) → the two-texture effects

Engine wiring per roadmap §1 F4: `GpuPass.samplers?: {name, key}[]` + an asset-texture cache
returning **sampler-only** textures (`NEAREST`/`REPEAT`, no FBO); `glEngine` binds after `u_tex`
(`pass()` already loops N reads). Then, cheap in any order: **blue-noise dither** (ship the 128²
PNG, F8 — replaces the IGN approximation), **ASCII atlas** mode (creative-medium C2). *(M gate,
then S each)*

## P3 — F5 multi-pass → the effects the 2-FBO chain can't do

- **F5a (same-size internal N-pass API)** → separable gaussian **blur** (Q3), **DoG/XDoG** lineArt
  modes, structure-tensor smoothing. *(M)*
- **F5b (arbitrary-size RT pool / mip pyramid)** → **dual-filter bloom** + characterBloom upgrade
  (Q2: 13-tap down / 9-tap up + Karis average), anisotropic-Kuwahara downscale. *(M–L)*
- **F6 (float RTs, `EXT_color_buffer_float`)** — request it **only when** anisotropic Kuwahara
  lands (the signed structure tensor doesn't survive RGBA8) or HDR bloom is wanted. Per-op linear
  (F1) covers everything else. *(L, deferred)*
- **Anisotropic Kuwahara** — the flagship painterly effect; needs F5a + F5b + F6. Author from
  Kyprianidis 2010 per roadmap §4 (tensor → gaussian smooth → eigen/ellipse sampling). *(L)*

## P4 — New effects (roadmap specs; single-pass GPU where possible)

- **Halftone extensions** (§2 #4/7/12/13): stagger, invertCells, overflow (3×3 neighborhood `min`
  of SDFs, constant bounds), gooey (`smin`). CPU + GL together (one lattice spec). *(S each)*
- **Chromatic upgrade** (§6): multi-sample loop, `samples 1–16`, rygcbv `quality:high`. Note the
  CPU chromatic also wants its per-sample clamps/hypot hoisted when touched. *(S–M)*
- **Creative-medium singles** (§7): C1 receipt, C5 LED panel, C6 crochet, C8 fluted glass, C7
  lego-light upgrade. *(S–M each)*
- **GPU SDF patterns** (§8 Phase 2: hex/truchet/voronoi/moiré/fbm) — **author the spec first**
  (currently unspecified; source §G + F2/F3 prelude + integer hash on bounded cell ids). Only
  needed for animated drift; the CPU pattern source stays v1. *(M)*
- **Deferred (need state the engine lacks):** displaced/animated halftone dots (#14 — velocity
  trail texture), C9 depixelation, C10 mouse-trail (persistent feedback FBO = a new foundation).
  Decide on a feedback-buffer foundation only when one of these is actually wanted.

## Export performance track (parallel, independent)

1. GIF: reuse the quantized palette across frames (quantize frame 0, `applyPalette` the rest;
   re-quantize on scene cut or every N frames). Biggest export win. *(S–M)*
2. MP4: respect `VideoEncoder.encodeQueueSize` (await when > ~4) so long encodes don't balloon
   memory. *(S)*
3. Later: move still export into a worker (`OffscreenCanvas`) — the CPU ops are canvas-based and
   port cleanly; kills the remaining UI freeze on huge exports. *(M–L)*

## Verification harness (build once, pays every op)

- **Parity page** (dev-only route or script): render a config on both engines at identical dims,
  diff pixels, report max/mean delta. Use it as the definition-of-done gate for every GL pass
  (halftone-style contracts get "≤1 LSB" targets; stochastic ops like grain compare statistics).
- **Bench harness**: render a reference stack N frames, report ms/frame — before/after numbers for
  every P0–P3 item, in the PR description. No perf claim without a number.
- Workflow per op stays as in the handoff: `pnpm exec tsc --noEmit` → **headed** visual QA (GL +
  `?engine=cpu`) → build. Compiles ≠ correct for visual code.

## Sequence summary

| Order | What | Gate | Size | Status (2026-07-03 overnight) |
|---|---|---|---|---|
| P0 | honesty + hygiene (7 items) | — | ~1 day | ✅ shipped (PR #4) |
| P1 | grain, gradientMap, kuwahara, lineArt, crt GL passes | P0.1 harness | ~2–3 days | ✅ all 5 + halftone parity fix. Bench: kuwahara smooth 2790×, lineArt 724×, crt 60×, grain 47×, gradientMap 44× |
| P2 | F4 wiring → blue-noise, ASCII atlas | F4 | ~1–2 days | ✅ F4 + blue-noise (0.00 parity; shared TS module, not PNG). ASCII atlas deferred → per-effect quality pass |
| P3 | F5a → blur/XDoG; F5b → bloom; F6+aniso-Kuwahara | F5a/b/6 | ~3–5 days | ✅ F5a + blur(4 modes)/bloom/characterBloom. F5b pyramid skipped (full-res separable already >60fps); XDoG + F6/aniso still open |
| P4 | halftone extras, chromatic, creative-medium, SDF patterns | specs | as picked | ◐ overflow+gooey shipped (1.00 parity); chromatic upgrade in flight; creative-medium singles + SDF patterns open |
| ∥ | export track (GIF palette, MP4 backpressure, worker) | — | interleave | next up |

Post-P3 bridge status: every op in the preset library runs GPU-side except the
by-design CPU composites (braille/mosaic/lego/glitch/filmDust, error-diffusion
dither, shaped pixelate, >8-stop gradientMap). Known accepted divergences and
the CPU blur-family edge-alpha quirk are documented in the P1/P3 commits.
