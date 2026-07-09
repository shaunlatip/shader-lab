// Dev-only preset thumbnail generator. Never reachable in production (see
// the notFound() guard). Renders every preset through the CPU engine (the
// export source of truth) against public/presets/_reference.png and POSTs
// each result to /api/dev/thumbs, which writes public/presets/<slug>.webp.
// Re-run whenever preset builds or effect defaults change.

import { notFound } from "next/navigation";
import ThumbsClient from "./ThumbsClient";

export default function ThumbsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ThumbsClient />;
}
