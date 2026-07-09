# Handoff: remaining engine-performance-plan work

**Audience:** a fresh agent session picking this up cold. **Branch:** `shaunlatip/perf-overnight`
(already has 12 commits, pushed, no PR yet — that stays a human checkpoint, don't open one).
**Companion docs, read in this order before starting:** `docs/effects-lab-handoff.md` (architecture
contract), `docs/engine-performance-plan.md` (what shipped + the doctrine),
`docs/effects-lab-shader-roadmap.md` (per-effect math specs — §5, §7, §8 are the sections you need).

## Why this is what's left (context, not a complaint)

The prior session executed `engine-performance-plan.md` P0→P4 + export track in ranked order against
a fixed time budget (one overnight run). It didn't run out of correctness — it ran out of *time*,
and stopped exactly at the boundary the plan itself predicted: everything ranked above this line
shipped with verified parity; everything below either (a) was explicitly ranked lowest in the plan
doc, or (b) was blocked on a decision or spec the roadmap flags as **not yet authored** — and the
prior session correctly refused to guess at those rather than ship unverified parity claims (that's
the "parity is authored, not hoped for" doctrine in the plan doc — it held even under time pressure).
Two items in particular were mis-scoped going in: the ASCII atlas was assumed "S" but actually needs
the full F4 sampler-binding path built out, and the SDF pattern generator was explicitly marked
"currently unspecified" in the roadmap (line 309, 388) — nobody had done the design work yet. This
handoff resolves those two blockers below so you don't hit the same wall.

## Non-negotiable working rules (carried over — do not skip any of these)

- **Headless has no WebGL2.** Every GL-side change needs `browse --headed` (pass `--headed` on
  every call). Verifying only `?engine=cpu` in headless silently tests nothing GPU-side — this is
  how the two shipped shader-compile bugs escaped originally.
- **Parity doctrine:** GPU `atan`/`sin` are approximate — never let them decide a discrete branch
  (use integer classification). f32 needs integer-exact accumulation for stats. `mod` on fractional
  operands diverges CPU/GPU — quantize to integer px first. `floor(px)` before texel math. Jitter
  hashes must be integer-bounded (`hash1`/`hashf` at `shaders.ts:626-633`, or the CPU
  `hash2`/`Math.imul` pattern at `effects-lab-shader-roadmap.md:317-322`) — never `sin(hugeCoord)`.
- **Dev-mode shader self-check** compiles every `GL_OPS` frag at GL-engine construction — trust it,
  don't hand-verify compilation.
- **Workflow per op:** `pnpm exec tsc --noEmit` → headed visual QA (GL **and** `?engine=cpu`) →
  parity-harness entry in `/dev/parity` → bench if it's perf-motivated → `pnpm build`. Compiling
  isn't correct for anything visual.
- **Commit granularity:** one commit per independently-shippable *unit*, not per numbered item on
  the task list below. Items 1, 2, 5, and 6 are each one unit. **Items 3 and 4 are five units each**
  — every pattern in item 3 (hex, truchet, voronoi, moiré, fbm) and every effect in item 4 (receipt,
  LED panel, crochet, lego-light, fluted glass) is independently shippable and independently useful
  the moment it lands, so each gets its own commit (CPU+GL together per unit, matching the existing
  halftone-overflow/chromatic precedent of one commit per complete effect). This matters
  specifically because the session may run out of budget mid-item: if items 3/4 were each one big
  commit, stopping after 3 of 5 patterns would either lose those 3 patterns' verified work or force
  shipping an unverified 4th/5th pattern to make the commit "complete" — neither is acceptable. Push
  after each commit; don't batch unrelated units into one commit.
- **Suggested execution model** (worked well last time): if you delegate any item to a subagent,
  verify its parity/bench claim yourself before committing — the prior run's orchestrator caught 3
  real GPU bugs this way (texel-boundary sampling, `atan` sector-boundary ties, double-applied
  overscan zoom) that the implementing agent couldn't see from source alone.

## Execution model — full scope, single continuous session

**All six items below are in scope. None are pre-cut for time.** Work through them sequentially,
in the order given (the order is risk/dependency sequencing, not a priority cutoff — every item is
meant to be attempted, not just the early ones). Commit and push after each item lands and verifies,
so progress is never lost. If the session hits its rate/turn limit mid-item, stop wherever that
happens — the commit history up to that point is real, verified progress, not a partial gamble.
**Do not preemptively drop an item because it looks big** (item 5, the ASCII atlas, is the one most
likely to tempt that — don't); the sizing estimates (S/M/L) are for sequencing, not for permission to
skip. The one exception is the "explicitly out of scope" section at the bottom — those four are
excluded because they need a *new engine foundation*, not because of time, and that's a separate
decision from what's covered here.

## Ordered task list

### 1. CPU blur-family edge-alpha fix — size S, do first

**Files:** `src/lib/bg-lab/engine/cpu/ops.ts:68-143` (`blur`, all 4 modes). Documented divergence:
commit `d5687fb`.

The bug: `gaussian` mode overscans the source by `r` px (`ops.ts:140`) before applying
`ctx.filter = blur(${r}px)`, but a CSS/canvas gaussian blur's actual kernel reach is ~3σ — so pixels
within `3r` of the true edge but outside the `r`-px overscan sample transparency and pick up partial
alpha (corner alpha drops to 183/255 in the harness). `directional` mode's incremental-average loop
(`ops.ts:80-89`) composites shifted copies of the same canvas; pixels only covered by some of the 14
shifts land at edge alpha as low as 32/255. `radial` likely has the analogous issue (uncovered scaled
copies at the frame edge) — check it too.

**Fix direction:** extend the overscan to the real kernel reach (`3 * r`, or the CSS-spec-accurate
constant if you want to derive it from the standard-deviation formula browsers use for
`filter: blur()`), not just `r`. Alternative that avoids over-drawing: edge-clamp-extend the source
canvas (duplicate the outermost row/column of pixels outward by the overscan amount) before
blurring, so there's no transparent halo to blur into at all — this is closer to what the GL pass
already does (`shaders.ts:1081-1149`, which renormalizes to stay opaque). Pick whichever is simpler
to verify; either should converge alpha to 255 at every edge for an opaque source.

**Verify:** re-run the existing `/dev/parity` blur/bloom configs (already present from commit
`d5687fb`) against a solid opaque source image; corner/edge alpha should read 255. Confirm GL blur's
rgb parity numbers (bloom max 2/255, etc.) are unchanged — this is a CPU-only fix.

### 2. XDoG lineArt mode — size M

**Files:** CPU `src/lib/bg-lab/engine/cpu/converters.ts:293-340` (`lineArt`, modes
`outline`/`hatch`/`ink`); GL `src/lib/bg-lab/engine/gl/shaders.ts:814-933` (`lineArt` `GpuPass`); F5a
executor interface at `shaders.ts:16-44` (`MultiPassCtx`/`GpuPass.multi`).

The roadmap (`effects-lab-shader-roadmap.md:259`) gates XDoG on F5a, which now exists and is proven
(blur/bloom/characterBloom all use it). The actual blocker was never the executor — it was that the
CPU-side algorithm decision was never made. Resolving it now: implement standard **XDoG**
(Winnemöller et al.) —

```
D(x)   = G_σ(x) − τ·G_{k·σ}(x)          // difference of two gaussians on luma
XDoG(x) = 1                              if D(x) ≥ ε
        = 1 + tanh(φ·(D(x) − ε))         otherwise
```

with `k` fixed at 1.6 (standard), `τ` fixed at 0.99, and `σ`, `ε`, `φ` exposed as
`sigma`/`threshold`/`edgeSoftness` params on the existing `lineArt` control set (new
`mode: "xdog"` alongside `outline`/`hatch`/`ink`).

- **CPU:** two gaussian blurs of luma at `σ` and `1.6σ` (a plain separable box/gaussian pass is fine
  at the radii this op uses — lineArt isn't typically animated at large radius), then the per-pixel
  `D`/`tanh` combine. This is the "CPU impl decision" the roadmap left open; the answer is: nothing
  exotic, XDoG is just two blurs and a formula.
- **GL:** add `xdog: GpuPass` using `multi()`: two separable-gaussian passes via `ctx.run()` (reuse
  the existing blur frag's gaussian step from `shaders.ts:1081-1149` parameterized by `σ` and `1.6σ`,
  landing in two named temps), then a combine step implementing the formula above, writing to
  `ctx.output`.
- **Parity target:** treat this like the blur family (statistical/accepted-divergence tier), not
  like halftone's 1.00 — gaussian blur itself already isn't bit-exact CPU/GL (Skia 3-box vs true
  gaussian). Don't chase exactness the underlying blur doesn't have.

### 3. GPU SDF patterns — all five (hex, truchet, voronoi, moiré, fbm) — size M–L (spec below resolves the "unspecified" blocker)

**Files:** roadmap `effects-lab-shader-roadmap.md:302-354` (§8, the CPU v1 patterns — already
shipped, don't touch); the GL prelude at `shaders.ts:46-68` (`HEADER`: `rot`, `aaMask`, `sdCircle`,
`sdBox`, `sdDiamond`, `sdRing`); the halftone shader at `shaders.ts:409-495` as the reference
implementation of the **rotated-lattice + 3×3-neighborhood** convention this should reuse — same
rotate-into-grid-frame → `floor(...+0.5)` cell index → `dotSDF` → `aaCov` pipeline halftone already
uses, just with a different per-cell test than "is this a dot."

**Prerequisite (do this first, before any of the five patterns — 15 minutes, not its own commit,
fold into pattern #1's commit):** the integer-hash function (`hash1`/`hashf`, currently at
`shaders.ts:626-633`) is **not** in `HEADER` — it's defined inside `grain`'s own `frag` template
string (`f() = HEADER + body`, `shaders.ts:71`; each `GpuPass.frag` is its own independent GLSL
program, only `HEADER` is shared across all of them). Truchet, voronoi, and fbm below all need this
exact hash. Move it into `HEADER` (`shaders.ts:46-68`) once, then every new pass just calls it — do
**not** copy-paste it into three separate frag strings, that's exactly the kind of divergence-prone
duplication the parity doctrine exists to prevent (if one copy ever drifts from another, jitter stops
matching between patterns for no visible reason). Same applies to any halftone-lattice math item 3
ends up needing in more than one pattern (see moiré below) — hoist to `HEADER`, don't duplicate.

The roadmap explicitly marks this Phase 2 as unspecified (line 309: "not yet specified... marked
explicitly as future"; line 388: "GPU pattern SDFs → Phase 2, currently unspecified"). That's the
real blocker — author it now rather than re-deferring:

- **New GL pattern source op** (parallel to the CPU `PATTERN_CATALOG`, not a replacement — CPU v1
  stays the resolution-sharp export path per the roadmap's explicit decision at line 304): a
  `GpuPass` that, per pixel, computes a cell index in a (possibly rotated) lattice frame exactly like
  halftone's `Q`/`kx0`/`ky0` setup, then evaluates a per-pattern SDF:
  - **hex**: cell index via axial hex coordinates (standard `q,r` skew: `vec2 axial = vec2(P.x - P.y/sqrt(3.0), 2.0*P.y/sqrt(3.0)) / cellSize`, round to nearest hex via cube-coordinate rounding), then `sdHex(p, r) = max(max(abs(p.x)*0.866+abs(p.y)*0.5, abs(p.y)) - r, 0.0)`-style hex SDF (iq's `sdHexagon`).
  - **truchet**: reuse the existing square-lattice cell index (same as halftone's `Q`/`kx0`/`ky0`),
    per-cell integer hash (`hash1`/`hashf`, `shaders.ts:626-633` — **not** `sin`) picks one of 2–4
    tile orientations, each tile is two `sdRing`/`sdCircle` quarter-arcs offset to opposite corners.
  - **voronoi**: per pixel, scan the 3×3 neighborhood of the surrounding square lattice cell (same
    cell index as halftone/truchet); each of the 9 cells gets one jittered feature point via
    `hash1`/`hashf` on the cell's integer id (two independent hash calls for the point's x/y offset
    within its cell — same two-hash-with-different-seed pattern `grain`'s `cellNoise` already uses
    at `shaders.ts:639-640`, *not* dither — dither uses the blue-noise texture, not a procedural
    hash); track the nearest and second-nearest distances (`F1`, `F2`) across the 9 points. Fill =
    `aaCov` on `(F1 - cellRadius)` for the classic cell look, or `aaCov(F2 - F1)` for
    cracked/border-only Voronoi — expose both via a `style{cells,edges}` param.
  - **moiré**: two independent instances of the same rotate-into-grid-frame → cell-index → `dotSDF`
    → `aaCov` **math** halftone's `cmykScreen` already implements (`shaders.ts:439-471`), at two
    different angles or two slightly different `cell` sizes, combined by `min` (or `*` for a darker
    interference look) instead of laid over a photo. Note this is porting the *pattern*, not calling
    `cmykScreen` itself — it's written against halftone's own uniforms (`u_shape`, `u_rscale`,
    `u_gooeyK`, etc.) and lives inside halftone's own frag string, so it isn't reachable from a new
    pass any more than `grain`'s hash is (same `HEADER`-only-sharing constraint noted above). If the
    lattice math ends up needed in 3+ places (halftone, moiré, truchet's tile placement), that's the
    signal to hoist *it* into `HEADER` too rather than hand-copying the rotation/cell-index math a
    third time. Cheapest of the five to get right since the math is already proven — do this one
    first within item 3 to bank a quick win.
  - **fbm**: this one isn't a cell/edge pattern like the other four, it's a continuous value field —
    layer 4–6 octaves of integer-hash-based **value noise** (bilinearly interpolate the 4 corner
    hashes of the enclosing lattice cell via `hash1`/`hashf`, smoothstep the interpolation weight per
    Perlin's improved-noise fade curve so it's C1-continuous, not raw `mix`), halving amplitude and
    doubling frequency each octave, summed and normalized to `[0,1]`. Threshold or ramp the result
    through `aaCov`/a gradient the same way other patterns produce a fill. This is the one item here
    that's a genuinely new primitive rather than a lattice-SDF reuse — budget it the most time within
    item 3.
- **Wiring:** this is a new `Source`-producing pattern, not a post-effect — follow whatever
  `EngineSource`/pattern-selection path the CPU `PATTERN_CATALOG` already uses (roadmap §8, F7) so
  both engines expose the same pattern list; the GL variant only needs to activate for animated
  drift (the roadmap's stated reason for wanting Phase 2 at all — static patterns stay on the CPU v1
  path, which is already resolution-exact).
- **Verify:** parity isn't the right bar here (CPU v1 is exact vector fills, GL is an SDF
  approximation) — instead confirm the GL version reads visually equivalent at a fixed frame and
  degrades gracefully (no seams at cell boundaries, no `sin`-hash jitter popping as animation drifts
  — this is exactly the failure mode the integer-hash rule exists to prevent).

### 4. Creative-medium effects: all five (C1 receipt, C5 LED panel, C6 crochet, C7 lego-light upgrade, C8 fluted glass) — size S–M each

**Files:** roadmap `effects-lab-shader-roadmap.md:292-298` (§7); existing `lego`
(`src/lib/bg-lab/engine/cpu/converters.ts:544-589`, CPU-only today, needs the "2D fake light"
upgrade only — the other four don't exist in any form yet, CPU or GL).

All five are single-pass GL per the roadmap; author each directly as a `GpuPass` with `frag` (no
`multi` needed) using the existing `HEADER` prelude. The roadmap's own ranking (line 298,
"Recommend first: C1, C8, C7-upgrade") is only sequencing advice, not a cutoff — do LED panel and
crochet too, same pass:

- **C1 receipt**: horizontal scanline/bar coverage (`mod(P.y, barPeriod)` quantized to integer px
  per the doctrine, not raw float `mod`) plus a paper-grain multiply; roadmap groups it with §3
  dither matrices for the bar pattern.
- **C5 LED panel**: column stagger + RGB sub-pixel split (three narrow rects per cell tinted
  R/G/B, same rotated-lattice cell index as halftone) + a border/bezel mask per cell (`sdBox` at a
  fixed inset from the cell edge, per `HEADER`).
- **C6 crochet**: rotated ellipses (`sdCircle` in a non-uniform-scaled local frame, i.e.
  `sdCircle(p / vec2(1.0, aspectRatio), r)`) with a per-row horizontal offset (`Q.x += rowOffset`
  on odd rows), same lattice-cell convention as truchet above.
- **C7 lego-light upgrade**: add a 2D fake-light term to the existing CPU `lego` — a fixed-direction
  highlight/shadow gradient per stud (`dot(studNormalApprox, lightDir)` where the fake normal is just
  the stud's SDF gradient, i.e. `normalize(p)` in the stud's local frame) layered multiplicatively
  over the existing stud fill. Port to GL once the CPU version is settled (this one has a CPU op
  already — extend it in place rather than starting fresh in `shaders.ts`).
- **C8 fluted glass**: sine-wave UV distortion (`p.x += sin(p.y * freq) * amp`, freq/amp as params)
  before sampling `u_tex`, plus a fake normal-based specular highlight from the same sine's
  derivative (`cos(p.y * freq) * freq * amp` as the local slope) for the glass-rib highlight.

**Each also needs a real CPU implementation, not a stub** — `OPS` in `ops.ts:981` is typed
`Record<EffectType, Op>`, so a new `EffectType` won't compile without a CPU entry, and per the F0
rule (`effects-lab-handoff.md:25`) still-export always runs the CPU engine — a no-op CPU stub would
compile but silently drop the effect from every exported still. Follow the `lego` precedent (already
both engines) rather than GL-only for all five.

### 5. ASCII/glyph GPU atlas — size M–L, do last of the "new effect" items

**Files:** existing CPU glyph core `src/lib/bg-lab/engine/cpu/converters.ts` (`renderGlyph`,
`braille`); F4 type stub `shaders.ts:12-14` (`AssetTexKey = "blueNoise128"` — needs a second key
added, e.g. `"glyphAtlas"`); the asset-texture cache in `glEngine.ts` that resolves `AssetTexKey` to
a bound sampler (already built and proven for blue-noise — extend it, don't rebuild it).

This is the item most likely to blow a time budget if under-scoped again — treat it as its own
multi-step sequence, not a single "S":

1. Generate a glyph atlas: render the active glyph ramp to an offscreen canvas (one cell per glyph,
   fixed grid), cache keyed by `(font, glyphSet, cellPx)` — mirror the base-texture-cache pattern
   already used for the source composite (`glEngine.ts`).
2. Register `"glyphAtlas"` as a second `AssetTexKey`, bind it the same way `blueNoise128` is bound
   today (`NEAREST`/no-FBO sampler, per the F4 contract at `engine-performance-plan.md:119-123`).
3. GL frag: per output cell, compute luma → glyph index → atlas UV offset, sample the atlas cell
   instead of drawing a canvas glyph.
4. Parity target: match the CPU glyph-selection-by-luma logic exactly (same ramp, same brightness
   buckets) — this one *should* be closer to 1.00 since glyph selection is a discrete lookup, not a
   continuous approximation.

### 6. Export still-export worker (OffscreenCanvas) — size S–M, independent of 1–5, any order

**Files:** `src/hooks/useExport.ts:57-106` (`exportStill`). Currently yields one macrotask
(`yieldToUI`, line 75) then runs the full-res CPU render synchronously on the main thread — the UI
freeze this causes on large exports is the last open item on the export track (GIF palette reuse and
MP4 backpressure already shipped).

Move the render into a Worker via `OffscreenCanvas.transferControlToOffscreen()`. Before assuming
this ports cleanly ("the CPU ops are canvas-based and port cleanly" per the original plan doc), grep
`ops.ts`/`converters.ts` for any direct `document.*` or `window.*` calls in the render path — those
don't exist inside a worker and would need hoisting out to the main thread before the worker call.

## Explicitly out of scope — do not start these

Anisotropic Kuwahara, F6 (`EXT_color_buffer_float`), the mouse-trail persistent-feedback FBO,
progressive depixelation. All four need engine foundations beyond what's built (F5b RT pool + F6 for
aniso-Kuwahara; a whole new feedback-buffer foundation for mouse-trail/depixelation) — the prior plan
correctly deferred these pending an explicit decision to build that foundation, and nothing above
changes that calculus.

## Definition of done

- `pnpm exec tsc --noEmit` and `pnpm build` clean.
- Each item above: headed GL verification + `?engine=cpu` verification + a `/dev/parity` harness
  entry (where parity is the right bar — see item 3's note) + a bench number if the item is
  perf-motivated, committed on its own.
- Push to `shaunlatip/perf-overnight` after each commit. No PR — that stays the user's checkpoint.
- Update `docs/engine-performance-plan.md`'s status table (the `## Sequence summary` table)
  **incrementally, after each numbered item (1-6) finishes** — not saved for one pass at the very
  end. The same "don't lose real progress to a rate-limit cutoff" reasoning behind splitting items 3
  and 4 into per-unit commits applies here too: if the status-table update is the very last thing
  planned and the session ends before item 6, real shipped work goes undocumented even though it's
  safely committed.
- **If the session ends before item 6**, the stopping point is still "done" for everything verified
  and committed up to there — there is no partial-credit penalty for not reaching the end of the
  list. What matters is that nothing was skipped *by choice*; running out of turn/rate budget mid-list
  is the expected and acceptable way this session ends.
