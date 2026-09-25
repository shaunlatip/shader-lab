// Dev-only frame renderer for portfolio before/after clips. Renders the PNG
// frames in public/dev-ref/render/<clip>/ (gitignored; extracted with ffmpeg)
// through a preset with the CPU engine — the export source of truth — and
// POSTs each result to /api/dev/render. Runs in the browser because some ops
// (Kuwahara) don't render under the Node canvas shim used by scripts/render.ts.
//   /dev/render?clip=butterfly&preset=oil-paint&frames=195

import { notFound } from "next/navigation";
import RenderClient from "./RenderClient";

export default async function RenderPage({
  searchParams,
}: {
  searchParams: Promise<{ clip?: string; preset?: string; frames?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { clip = "", preset = "", frames = "0" } = await searchParams;
  return <RenderClient clip={clip} preset={preset} frames={Number(frames)} />;
}
