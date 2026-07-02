# Shader Lab — migration plan

Move the portfolio's **Effects Lab** (a WebGL/CPU image + video effects studio, internally
codenamed `bg-lab`) into this standalone **`shader-lab`** repo, rename it user-facing to
**Shader Lab**, and host it on Next.js (Vercel).

## Where things stand

**Source** — `~/Documents/Projects/.portfolio/dev/` (the `dev` worktree of the portfolio).
Branch `shaunlatip/ascii-magic-feature-audit`, local commits only (nothing pushed). The lab is
**done and shipped-quality**; ~7,300 LOC across ~43 files and it is remarkably self-contained.

| Piece | Path (source) | Size |
|---|---|---|
| Engine (CPU + WebGL + export) | `lib/bg-lab/**` | 20 files, ~4,470 LOC |
| UI | `components/bg-lab/**` | 23 files, ~2,820 LOC |
| Hooks | `hooks/useExport.ts`, `hooks/useImageSource.ts` | 2 files |
| Page entry | `pages/effects-lab.tsx` | thin `dynamic(ssr:false)` wrapper |
| Pexels proxy | `pages/api/pexels.ts` | needs `PEXELS_API_KEY` |
| Example clips | `public/effects-lab/*.mp4` | 6 before/after videos |
| e2e | `e2e/bg-lab.spec.ts` | 48 Playwright cases |
| Reel (optional) | `remotion/reel/BgLabReel.tsx` + 4 | video render, not core |

**Target** — this repo (`shaunlatip/shader-lab`, already on GitHub). Fresh **Next.js 16 App
Router**, **React 19**, **pnpm**, **Tailwind v4**, `@/* → ./src/*` alias, Geist fonts. Currently
just the create-next-app scaffold.

**The gap to cross:** Pages Router → App Router · Next 13 → 16 · React 18 → 19 · yarn → pnpm.
The engine is framework-agnostic canvas/WebGL code (zero risk); the work is the Next surface,
the Tailwind token layer, and the shadcn UI primitives.

---

## Decisions to confirm before starting

1. **Route.** The repo *is* the lab, so make it the home page: `/effects-lab` → `/`. (Alt:
   keep it at `/shader-lab`.) → **Recommend `/`.**
2. **Internal `bg-lab` name.** It's threaded through ~43 files, docs, test IDs and localStorage
   keys. Rename only the **user-facing** strings now ("Effects Lab" → "Shader Lab"); keep the
   `bg-lab` identifier internally. A full internal rename is a mechanical follow-up, not v1.
   → **Recommend: user-facing only for v1.**
3. **Scope.** Effects Lab only for v1. Exclude `brick-breaker` (unrelated game). `lissajous-explore`
   is an independent experiment (`lib/lissajous.ts`, not the bg-lab engine) — a "lab" could hold it
   later as `/lissajous`, but leave it out of v1. Remotion reel: **defer** (video-render tooling,
   adds a heavy dep).
4. **localStorage.** New domain = users start fresh. Keys are namespaced; no migration needed.

---

## Phase 1 — Destination deps & config

Add to `package.json` (React-19-compatible versions) and `pnpm install`:

```
nanoid @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
mp4-muxer gifenc            # export (MP4 via WebCodecs, GIF)
lucide-react sonner cmdk    # icons, toasts, command palette
radix-ui                    # unified radix package (shadcn primitives)
class-variance-authority clsx tailwind-merge
next-themes                 # theme provider (sonner + .lab-chrome)
```
Dev: `@playwright/test` (only if porting e2e). **Not needed:** remotion, @vercel/analytics,
react-hotjar, d3-hierarchy, react-markdown, phosphor-icons (portfolio-only). Keep pnpm pinned to
`pnpm@10.15.0` (already fixed — corepack 0.29.4 crashes on pnpm 11; see
`docs/` / memory note).

**Tailwind tokens (the fiddly part).** The portfolio `styles/globals.css` is a ~1,000-line design
system — do **not** copy it wholesale. Port only the tokens bg-lab references into this repo's
`src/app/globals.css` `@theme` block:
- colors: `--color-canvas`, `--color-text-primary/secondary/tertiary`,
  `--color-border-default/strong`, `--color-shade-9/10`, `--color-accent`
- UI accent: `--ui-primary`, `--ui-primary-fg`, and the `.lab-chrome { --color-accent: … }`
  neutralization block
- cursor vars: `--cur-default/pointer/text/grab/grabbing/col-resize/zoom-in`
- the shadcn token layer (`--background`, `--foreground`, `--muted`, `--border`, `--ring`,
  `--popover`, `--primary`, etc.) required by the copied UI primitives
- radius tokens used (`rounded-card`, `rounded-frame`) and any spacing extras (`gap-104`, etc.)

Verify by grepping the copied files for `var(--` and non-standard utility classes, then adding
only what's referenced. Both repos are Tailwind v4, so `@import "tailwindcss"` + `@theme` carries over.

**Fonts.** Lab uses **Work Sans** + **Archivo** (via `next/font`). Add them in
`src/app/layout.tsx` with `next/font/google`, exposing `--font-work-sans` / `--font-archivo`.

**Providers.** Add a `src/app/providers.tsx` (`'use client'`) wrapping children in
`next-themes` `ThemeProvider`. `BgLab` already provides its own `TooltipProvider`, `Toaster`, and
`BgLab/Source/Library` providers, so the root only needs the theme provider.

---

## Phase 2 — Copy the self-contained subsystem (mechanical)

The source uses `@/…` where `@` = repo root; here `@` = `./src`. So everything lands under `src/`
and imports resolve **unchanged**:

| From (source) | To (this repo) |
|---|---|
| `lib/bg-lab/**` | `src/lib/bg-lab/**` |
| `components/bg-lab/**` | `src/components/bg-lab/**` |
| `hooks/useExport.ts`, `hooks/useImageSource.ts` | `src/hooks/**` |
| `lib/utils.ts` (`cn()`) | `src/lib/utils.ts` |
| `components/ui/*` (shadcn) | `src/components/ui/*` |
| `public/effects-lab/*.mp4` | `public/effects-lab/*` |

**shadcn UI set to copy** (imported by bg-lab): `button, input, textarea, label, tabs, select,
slider (+ slider-neutral), switch (+ switch-neutral), tooltip, scroll-area, toggle, toggle-group,
dialog, popover, dropdown-menu, command, separator, card, sonner`. Drop any that grep shows unused
(e.g. `accordion`).

---

## Phase 3 — Port the Next.js surface (Pages → App Router)

1. **Page.** `pages/effects-lab.tsx` → `src/app/page.tsx`. App Router forbids
   `dynamic(…, {ssr:false})` inside a Server Component, so use a tiny client wrapper:
   ```tsx
   // src/app/page.tsx  (Server Component)
   import type { Metadata } from "next";
   import ShaderLab from "./ShaderLab";           // client wrapper
   export const metadata: Metadata = {
     title: "Shader Lab — image effects studio",
     description: "A studio for layered image effects — pixelate, dither, halftone, gradient maps, grain and more.",
   };
   export default function Page() { return <ShaderLab />; }
   ```
   ```tsx
   // src/app/ShaderLab.tsx
   "use client";
   import dynamic from "next/dynamic";
   const BgLab = dynamic(() => import("@/components/bg-lab/BgLab"), { ssr: false });
   export default function ShaderLab() { return <BgLab />; }
   ```
   `next/head` → the Metadata API above.
2. **Back-link.** `components/bg-lab/Sidebar.tsx` has a `next/link` "back to /". Since this is now
   the home page, remove it or repoint it (e.g. to the portfolio).
3. **Pexels API.** `pages/api/pexels.ts` → `src/app/api/pexels/route.ts` as a **Route Handler**:
   convert `(req: NextApiRequest, res: NextApiResponse)` → `export async function GET(req: Request)`
   returning `Response.json(...)`; read query via `new URL(req.url).searchParams`; keep the
   graceful `501` when `PEXELS_API_KEY` is unset. Client `fetch('/api/pexels?…')` is unchanged.

---

## Phase 4 — Env & rename

- **Env.** Add `PEXELS_API_KEY=…` to `.env.local` (currently empty; it's symlinked to
  `~/Documents/Projects/shader-lab/.env.local`). Without it, image/video search degrades to the
  bundled gallery + upload — the app still works.
- **Rename to Shader Lab (user-facing).** Grep the copied files + `README.md` for "Effects Lab" /
  "effects-lab" in visible strings (page title/metadata, `CanvasHeader` title, any headings) and
  change to "Shader Lab". Leave internal `bg-lab` identifiers alone (decision #2). Rewrite the
  create-next-app `README.md`.

---

## Phase 5 — Verify (don't trust "it compiles" for visual effects)

1. `pnpm exec tsc --noEmit` (add a `typecheck` script) → clean.
2. `pnpm build` → green. **Next 13→16 / React 18→19 watch-items:** flat ESLint config (this repo
   already has `eslint.config.mjs`) may flag a few rules; `radix-ui`/`cmdk`/`dnd-kit`/`sonner`/
   `motion` all support React 19; async route/`params` changes don't affect this mostly-client app.
3. `pnpm dev`, open `/`, and **visually** exercise: add each effect (ASCII/Halftone/lineArt/
   Kuwahara/Dither/Dispersion), Pattern source, PNG/GIF/MP4 export, video transport — on the
   default GL engine **and** `?engine=cpu` (they must match; the CPU op is the export source of truth).
4. Optional: port `e2e/bg-lab.spec.ts` (+ `playwright.config.ts`), `pnpm exec playwright test`.

Gotchas carried from the source handoff: WebCodecs/`mp4-muxer` needs a recent Chromium/Safari 16.4+
(export only). The "`yarn build` corrupts running dev" note was yarn-specific; still avoid running
`build` against a live `dev` (shared `.next`).

---

## Phase 6 — Host on Next.js (Vercel)

1. Repo already exists (`shaunlatip/shader-lab`). Commit the migration on a branch, open a PR,
   merge to `main`.
2. New **Vercel project** → import `shaunlatip/shader-lab` → framework auto-detects Next.js →
   set **`PEXELS_API_KEY`** env (Production + Preview) → deploy.
3. **Vercel Hobby contribution check:** the author must be **Shaun Latip only** — do **not** add
   `Co-Authored-By` trailers to commits in this repo, or Hobby deploys get blocked. (This overrides
   the default commit-trailer habit for this repo specifically.)
4. Optional: custom domain (e.g. `shaderlab.shaunlatip.com`).

---

## Phase 7 — Portfolio cleanup (later, optional)

Once Shader Lab is live standalone, decide whether the portfolio's `/effects-lab` page +
`ExperimentsRail`/`EffectsLabCompare` should link out to the hosted site or be removed. Not part of
this migration.

---

## Effort & risk

- **Effort:** ~½–1 day. Phase 2 is minutes (copy). The real time sinks are the Tailwind token port
  (Phase 1) and the App-Router page/API port (Phase 3); verification (Phase 5) is the rest.
- **Highest risk:** missing a CSS token → UI looks broken but compiles. Mitigate by grepping
  `var(--` in the copied set and diffing against what you added to `globals.css`.
- **Low risk:** the engine itself — pure canvas/WebGL/TS, no framework or portfolio coupling.
- **No deep coupling** to NavbarLayout, Transitions, IntroLoader, Lightbox, analytics, or the
  portfolio design system — confirmed by import trace.
</content>
</invoke>
