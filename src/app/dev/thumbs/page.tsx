// Dev-only preset thumbnail generator. Never reachable in production (see
// the notFound() guard). Renders every preset through the CPU engine (the
// export source of truth) against public/presets/_reference.png and POSTs
// each result to /api/dev/thumbs, which writes public/presets/<slug>.webp —
// plus the Looks rail's example thumbnails into public/examples/<slug>.webp.
// Re-run whenever preset builds, examples, or effect defaults change;
// `?only=<slug>,examples` re-shoots a subset.

import { notFound } from "next/navigation";
import ThumbsClient from "./ThumbsClient";

export default async function ThumbsPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { only } = await searchParams;
  return <ThumbsClient only={only ?? null} />;
}
