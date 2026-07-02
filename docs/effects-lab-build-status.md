# Effects Lab — build status (historical log)

> **Repo note (2026-07):** this log was written in the portfolio repo (branch
> `shaunlatip/ascii-magic-feature-audit`, review URL `localhost:3220/effects-lab`). Everything
> listed below — through the GPU halftone mono + CMYK passes — was carried into this standalone
> Shader Lab repo at extraction (verified commit-by-commit; no drift). New work: log it here.

Implementation = CPU ops that auto-bridge in the GL
engine, so **preview == still export by construction** (no CPU↔GL parity risk).

## Shipped & verified (visual + tsc + production build green)

| Commit | What | Verified |
|---|---|---|
| `179ddc2c` | image-based glyph defaults + grouped/conditional controls + roadmap docs | earlier |
| `e6bddc38` | **Halftone**: gamma-correct coverage, reference `rgb2cmyk` (K extraction), `stagger`, `invertCells` | screenshot (mono + CMYK) ✅ |
| `6230ac26` | **Pattern generator source** (new): dotGrid / lineGrid / checker / stripes / rings / iso — CPU-drawn on the base in both engines; Source tab + PatternPanel | screenshot (dotGrid) ✅ |
| `c4e8525e` | **lineArt** (new): Sobel-on-luma outline + crosshatch bands + hand-drawn wiggle (modes outline/hatch/ink) | screenshot (ink) ✅ |
| `af8cf4f9` | **Kuwahara** (new): 4-sector fast + 8-sector smooth painterly | screenshot (smooth) ✅ |
| `d563f61f` | **chromatic → dispersion**: radial offset + multi-sample prism + saturation (CPU+GL matched) | screenshot (radial) ✅ |
| `ccc7c8db` | **Dither**: gamma-correct quantize, retro pixelate-per-cell, stylized 8×8 matrices (stripes/crossStripe), Atkinson + Sierra | screenshot (bayer4 default) ✅ |
| `b46f58d7` | **Converge fixes** from codex review (see below) | tsc + build ✅ |
| `0e014ccc` | **GPU halftone pass (mono)** + F2/F3 GLSL prelude — Phase A keystone | GL==CPU pixel parity, all 5 shapes + stagger + invert ✅ |

Verification: `tsc --noEmit` clean, `yarn build` green (Done in 36s), and the 6 highest-risk effects
screenshotted headlessly on the Monet "Haystack" image (saved under /tmp/*.png during the run).

## How it was built
Foundations + orchestration by Opus; each effect implemented by a **Sonnet subagent** (sequential,
to avoid collisions on the shared `catalog.ts`/`ops.ts`/`types.ts`), each tsc-checked and committed.
Then a **codex review** of the full diff (`179ddc2c..HEAD`) — it found 1 real bug + parity nits, all
fixed in `b46f58d7`:
- **[P1]** dither error-diffusion quantized black→mid-gray at `levels=2` (`qLin` off-by-half) — fixed to `round(v*(L-1))/(L-1)`.
- Sierra-lite kernel direction; `pixelate` now unit-scaled in CPU **and** GL; chromatic `split` angle now matches CPU in GL; iso pattern left-edge coverage extended for the shear.
- Codex confirmed the Kuwahara per-pixel accumulators reset correctly (no cross-pixel corruption).

## Deferred (by design — needs supervised engine work, NOT attempted overnight)
These are the GPU-acceleration + multi-pass items from the roadmap. They're **pure performance / fidelity**
upgrades; the effects above already work (just CPU-bridged, not GPU-shaded):
- ~~**GPU halftone pass** + CPU↔GL parity contract~~ — **DONE** (`0e014ccc` mono, CMYK added next commit). Shader matches the existing CPU lattice exactly (sRGB perceptual coverage, -diag/2 phase, uniform 1.42 radius, 3x3 neighbour union for overlap); all 5 shapes + stagger + invert verified GL==CPU. CMYK (u_mode=1): 4 rotated screens C15/M75/Y0/K45, in-shader rgb2cmyk, per-neighbour multiply over white — matches the CPU canvas-multiply bridge (near-exact; CPU does 4 sequential 8-bit composites so overlaps can differ ≤1 LSB). Halftone now fully GPU; no bridge. **Still open in §2:** overflow/gooey/displaced dots (#12–14).
- **F4** multi-sampler binding → **blue-noise dither** + **ASCII atlas**.
- **F5a/F5b** RT pool → **separable/dual-filter bloom**, **DoG/XDoG** line-art, **anisotropic Kuwahara**.
- **F6** float RTs → HDR bloom + robust anisotropic tensor.
- Halftone **overflow/gooey/displaced** dots; **GPU SDF patterns** (hex/truchet/voronoi/moiré/fbm); creative-medium **C5 LED / C6 crochet / C8 fluted glass / C1 receipt**.

## Known minor follow-ups (non-blocking)
- `schema.ts` doesn't yet validate/round-trip `source.mode:"pattern"` (the AI copy-paste *full-config* path). Pattern works fully via the UI/localStorage; only matters for pasted configs. ~15-min add.
- Dither gamma-correctness slightly shifts the look at `levels=2` (sRGB 0.5 ≈ linear 0.214). Verified fine at the default `levels=3`; if you want the old 1-bit feel, consider keeping the ordered/threshold path in sRGB.
- Pattern v1 params are a shared set (cell/weight/jitter/angle/stagger/fg/bg); per-type extras (rings frequency, stripe width) could be added later.

## To review quickly
Add any new effect from the **Add an effect** menu (ASCII/Halftone/lineArt/Kuwahara/Dither/Dispersion),
or switch the Source to the new **Pattern** tab. Everything renders on both the default GL engine and
`?engine=cpu`.
