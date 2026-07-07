// Dev-only sink for the /dev/thumbs generator page: receives one rendered
// preset thumbnail as a data URL and writes it to public/presets/<slug>.webp.
// Refuses outside development — this route must never exist as a write
// primitive in production.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const { slug, dataUrl } = (await req.json()) as { slug?: string; dataUrl?: string };
  if (!slug || !SLUG_RE.test(slug)) {
    return NextResponse.json({ error: "bad slug" }, { status: 400 });
  }
  const m = /^data:image\/webp;base64,(.+)$/.exec(dataUrl ?? "");
  if (!m) {
    return NextResponse.json({ error: "expected webp data URL" }, { status: 400 });
  }
  const dir = path.join(process.cwd(), "public", "presets");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${slug}.webp`), Buffer.from(m[1], "base64"));
  return NextResponse.json({ ok: true });
}
