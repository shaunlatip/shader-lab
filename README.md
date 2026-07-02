# Shader Lab

A studio for layered image & video effects — pixelate, dither, halftone, ASCII,
line art, Kuwahara, dispersion, gradient maps, grain and more. Stack, reorder,
and export to PNG / GIF / MP4. Runs on a WebGL engine with a CPU fallback
(`?engine=cpu`), so preview matches export.

Extracted from the [portfolio](https://github.com/shaunlatip) "Effects Lab"
into its own app.

## Develop

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Pinned to `pnpm@10.15.0` (the bundled corepack crashes on pnpm 11).

## Pexels search (optional)

Image/video search is powered by [Pexels](https://www.pexels.com/api/). Set a
free API key so the source picker can search; without it, the picker degrades to
upload + the bundled gallery.

- Local: copy `.env.example` → `.env.local` and set `PEXELS_API_KEY`.
- Production (Vercel): set `PEXELS_API_KEY` in Project → Settings → Environment
  Variables (Production + Preview), server-side (not `NEXT_PUBLIC_`). The
  `/api/pexels` route proxies with it, so search works for everyone.

## Stack

Next.js (App Router) · React · Tailwind v4 · WebGL2 + Canvas 2D · WebCodecs /
`mp4-muxer` (MP4) · `gifenc` (GIF). Deployed on Vercel.

## Architecture

- `src/lib/bg-lab/` — the engine. Two implementations behind one contract
  (`engine/types.ts`): a CPU engine (`engine/cpu/`) and a WebGL engine
  (`engine/gl/`). Effects are CPU ops that auto-bridge in GL, so preview == export.
  The catalog (`catalog.ts`) drives available effects and their controls.
- `src/components/bg-lab/` — the editor UI (source picker, effect stack, export).
- `src/app/` — the Next.js App Router surface: the page, the client wrapper
  (`ShaderLab.tsx`, `ssr: false` because the editor touches canvas/WebGL), and
  the Pexels proxy route.
