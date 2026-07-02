# Shader Lab engine — engineering handoff (continue here)

> **Repo note (2026-07):** this doc was written inside the portfolio repo, where the lab lived at
> `/effects-lab`. The lab is now this standalone **Shader Lab** repo: the app is the home page `/`,
> code lives under `src/` (`src/lib/bg-lab`, `src/components/bg-lab`, `src/hooks`), the package
> manager is **pnpm**, and the dev server is `pnpm dev` (port 3000). Everything architectural below
> still holds. See also `docs/engine-performance-plan.md` for the current build order.

You're picking up the Shader Lab engine build (the image/video effects studio). The user-facing
effects are **done and shipped**; what's left is **GPU acceleration, parity, and a few new
effects** that need supervised engine work. This doc is self-contained — read it + the three
reference docs below and you can execute without the prior chat.

**Review URL:** http://localhost:3000/ (start the dev server — see Workflow).

## Read first (in order)
1. **This doc** — architecture you MUST respect + the remaining-work plan + how to verify.
2. `docs/effects-lab-shader-roadmap.md` — the per-effect implementation spec (COMPILING/SPEC GLSL, the foundations F0–F8, sequencing). This is your spec source.
3. `docs/effects-lab-source-reference.md` — the source techniques/formulas the specs are built from (Heckel/iquilezles/Book of Shaders).
4. `docs/effects-lab-build-status.md` — exactly what shipped (commit-by-commit) so you don't redo it.

## Architecture you must respect (load-bearing)
- **Two engines, one contract.** `src/lib/bg-lab/engine/types.ts` `RenderEngine`. CPU: `engine/cpu/cpuEngine.ts` walks the stack calling `OPS[type]` (`engine/cpu/ops.ts` + `engine/cpu/converters.ts`). GL: `engine/gl/glEngine.ts` runs GPU passes from `GL_OPS` (`engine/gl/shaders.ts`) over **two same-size ping-pong FBOs**, and **bridges** anything not in `GL_OPS` (or flagged in `shouldBridge`) by reading back to a 2D canvas, running the CPU op, re-uploading.
- **A new CPU op auto-works on both engines** (it bridges). That's why every effect so far is a CPU op — zero parity risk.
- **STILL EXPORT USES THE CPU ENGINE** (`src/hooks/useExport.ts`, `exportStill` → `cpu()`). So **the CPU op is the source of truth for export.** A GPU-only op makes export diverge from preview. Rule (roadmap F0): every op keeps a CPU implementation at param parity; GL is the preview accelerator — OR you switch `exportStill` to GL (a deliberate, separate change).
- **GL shader contract** (`shaders.ts`): a pass is `{ frag, setUniforms }`. `frag = f(body)` where `HEADER` already declares `#version 300 es`, precision, `in v_uv`, `uniform u_tex/u_texel/u_dims/u_unit/u_time`, `out o`, and `luma601/luma709`. **The body declares ONLY its own uniforms** (never redeclare HEADER's). `setCommon` (`glEngine.ts`) wires `u_dims/u_texel/u_unit/u_time`; your `setUniforms(gl,prog,p,u,t,dims)` wires the rest. Helpers in scope: `col(p,key,default)` (hex→[0..1] vec3), `loc`, `pn/ps/pb`.
- **glContext limits** (`engine/gl/glContext.ts`): textures are **RGBA8/UNSIGNED_BYTE** (no float RTs; `EXT_color_buffer_float` not requested), `LINEAR`/`CLAMP_TO_EDGE`. `pass()` *can* bind N samplers, but `glEngine` only ever binds `u_tex` (so a 2nd sampler — blue-noise/atlas — needs engine wiring: that's foundation **F4**).
- **Catalog drives everything** (`src/lib/bg-lab/catalog.ts`): to add an effect you add `EffectType` (`types.ts`) + an `EFFECT_CATALOG` entry + add the type to `EFFECT_ORDER` + register in `OPS` (and `GL_OPS` if you write a shader). `schema.ts` clamps params from the catalog automatically; `defaultParams` derives from it. Controls support `group` (sections) + `showIf` (conditional rows) — see `glyphControls`.
- **Pattern source** (already built): `SourceState.mode:"pattern"` + `PatternState` (`types.ts`), `EngineSource{kind:"pattern"}` (`engine/types.ts`), `drawPattern` (`engine/cpu/patterns.ts`) called from BOTH engines' base-draw, `components/bg-lab/PatternPanel.tsx`, `useImageSource.ts`, `library.ts`.

## Hard-won lessons (don't repeat these)
- **Tone→coverage must be PERCEPTUAL (sRGB), not linear.** Gamma-correcting halftone/dither *coverage* makes mid-tones over-ink → "too dark." Linear light is only for *averaging/compositing* (blur/bloom), not for mapping brightness→dot-size. (This bit us; fixed in commit `2b250181`.)
- **Source-color over the (blurred) source camouflages sparse shapes.** Dots/diamonds/lines colored like the photo behind them vanish. Shape styles default to flat `paper`; dense ramp styles (ASCII) can use `blurred`. Keep that distinction.
- **CPU↔GL parity is the hard part.** When you add a GL pass for an existing CPU op, the lattice/rotation/sampling must match exactly or preview≠export. For halftone specifically: rotate the screen about the **canvas center**, top-left/y-flip convention, sample the **cell-center texel** (nearest), drop the legacy `-diag/2` phase — make the CPU op adopt the shader's definition so there's ONE lattice (roadmap §2 "CPU↔GL parity contract"). Codex spent multiple passes on this; budget for it.
- **Don't run `pnpm build` against a running `pnpm dev`** (shared `.next`; this bit us under yarn). Safe order: stop dev → build → restart dev.
- **Config-injection race when QA'ing headlessly:** the provider debounce-persists, which can clobber your injected localStorage. Set storage, do a **single** `goto`, then read the config back to confirm before screenshotting. (Memory: `qa-bg-lab-headless`.)

## What's DONE (don't redo — see build-status.md)
Image-based glyph defaults + grouped/conditional controls; halftone (perceptual coverage, reference CMYK, stagger/invert); **pattern generator source** (dot/line/checker/stripes/rings/iso); **lineArt** (Sobel outline/hatch/wiggle); **Kuwahara** (fast 4-sector + smooth 8-sector); **dispersion** (radial + multi-sample, CPU+GL matched); **dither** (gamma quantize, retro pixelate, stylized matrices, Atkinson/Sierra). All are CPU ops (bridged), tsc + production-build green, visually verified.

## Remaining work (priority order)

### Phase A — GL acceleration + parity (perf; effects already work via bridge)
**GPU halftone (mono + CMYK) SHIPPED** with the CPU↔GL parity contract, including the F2/F3 GLSL
prelude (commits `0e014ccc`, `9f9a3c6c` — see build-status.md). Remaining Phase A: GL passes for
the other heavy bridged ops (blur, bloom, grain, lineArt, kuwahara, gradientMap are the costly
ones), but only where parity can be held. See `docs/engine-performance-plan.md` for the ordered
list — several need the F5 multi-pass foundation first.

### Phase B — F4 multi-sampler wiring → unlocks 2-texture ops
Extend `GpuPass` with optional extra samplers + an asset-texture loader returning a **sampler-only** texture (NEAREST/REPEAT, not the RGBA8 RTs from `createTexture`); have `glEngine` bind them after `u_tex` (`pass()` already loops over N reads). Then: **real blue-noise dither** (ship a 128² blue-noise PNG, replace the interleaved-gradient "blueNoise"), and **ASCII atlas** mode (creative-medium C2). Roadmap §1 F4, §3, §7.

### Phase C — F5/F6 multi-pass → the effects that need >2 FBOs
F5a (same-size internal N-pass API) → **separable gaussian blur**, **DoG/XDoG** lineArt mode. F5b (arbitrary-size RT pool/mip pyramid) → **dual-filter bloom** (upgrade `bloom`/`characterBloom`), **anisotropic Kuwahara** downscale. F6 (request `EXT_color_buffer_float`, RGBA16F) → HDR bloom + the signed structure tensor for anisotropic Kuwahara. Roadmap §1 F5a/F5b/F6, §4 (anisotropic pipeline + Kyprianidis cite), §5 (XDoG), §9 (bloom taps + gaussian weights).

### Phase D — remaining new effects
Halftone **overflow / gooey / displaced** dots (roadmap §2 #12–14; displaced needs F4 trail). **GPU SDF patterns** (hex / truchet / voronoi / moiré / fbm — roadmap §8 Phase-2, currently unspecified; author from source §G). Creative-medium single-pass picks: **C1 receipt**, **C5 LED panel**, **C6 crochet**, **C8 fluted glass** (roadmap §7, source §F).

### Phase E — minor follow-ups (non-blocking)
- `src/lib/bg-lab/schema.ts` doesn't validate/round-trip `source.mode:"pattern"` (the AI copy-paste *full-config* path). Pattern works via UI/localStorage; ~15-min add for paste round-trip.
- Dither at `levels=2`: gamma-correct quantize shifts the 1-bit crossover (sRGB 0.5 ≈ linear 0.214). Fine at the default `levels=3`; decide whether the threshold/ordered path should stay sRGB for the retro feel.
- Pattern params are a shared set (cell/weight/jitter/angle/stagger/fg/bg); add per-type extras (rings frequency, stripe width) if wanted.

## Workflow & conventions
- **Verify every change:** `pnpm exec tsc --noEmit`, then headless visual QA via the gstack `/browse` skill (config-injection method above; 1:1 zoom + `screenshot --clip` for fine detail), then for batches a **codex converge** review of the diff (`codex exec "review git diff <base>..HEAD ..." -s read-only -c 'model_reasoning_effort="high"'`). Don't trust "compiles" for visual effects — they fail silently (wrong pixels, no crash).
- **Token strategy:** top-tier model for foundations + parity-critical GL passes (high-stakes); smaller subagents for the contained per-op work, run **sequentially** (they all touch `catalog.ts`/`ops.ts`/`types.ts`/`shaders.ts` — parallel writers collide). Give each a tight brief pointing at the roadmap section + files + "tsc before returning, don't commit, don't run a build."
- **Git:** commit per logical unit. **NO `Co-Authored-By` trailers** (Vercel Hobby contribution check blocks deploys — author is Shaun Latip only). Branch + PR into `main`; merging `main` auto-deploys to Vercel.
- **Design:** UI chrome is neutral-only (no accent colors); effect fg/bg colors are user content (any hex fine). Match the terse codebase style; no new CSS modules.
- **Dev server:** `pnpm dev` (port 3000, background). It's the review surface; keep it running for the user.

## Definition of done for the remaining work
Each item: CPU+GL parity held (preview == export) or CPU-only by design; `tsc` + `pnpm build` green; visually verified on a real image (and `?engine=cpu`); committed with a clear message; build-status.md updated.
