// Dev-only sink for /dev/render: receives one rendered frame as a PNG data URL
// and writes it to .context/portfolio/frames/<clip>-edited/<frame>.png (the
// portfolio clip pipeline encodes those with ffmpeg). Refuses in production —
// never a write primitive outside local dev.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const CLIP_RE = /^[a-z0-9-]{1,32}$/;

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not available" }, { status: 404 });
  }
  const { clip, frame, dataUrl } = (await req.json()) as { clip?: string; frame?: number; dataUrl?: string };
  if (!clip || !CLIP_RE.test(clip)) return NextResponse.json({ error: "bad clip" }, { status: 400 });
  if (!Number.isInteger(frame) || frame! < 1 || frame! > 9999) {
    return NextResponse.json({ error: "bad frame" }, { status: 400 });
  }
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl ?? "");
  if (!m) return NextResponse.json({ error: "expected png data URL" }, { status: 400 });
  const dir = path.join(process.cwd(), ".context", "portfolio", "frames", `${clip}-edited`);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${String(frame).padStart(4, "0")}.png`), Buffer.from(m[1], "base64"));
  return NextResponse.json({ ok: true });
}
