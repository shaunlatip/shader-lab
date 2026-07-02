// GET /api/pexels?q=&page=&type=photo|video — proxies Pexels search with a
// server-side key. The key lives in the PEXELS_API_KEY env var (set in Vercel),
// so every visitor's search is proxied through it — no per-user key needed.
// Returns 501 (gracefully) when PEXELS_API_KEY is unset so the UI degrades to
// the bundled gallery + upload.

interface PexelsPhoto {
  id: number;
  alt: string;
  photographer: string;
  url: string;
  src: { medium: string; large2x: string; large: string };
}

interface PexelsVideoFile {
  link: string;
  quality: string;
  width: number | null;
  height: number | null;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  duration: number;
  url: string;
  user: { name: string };
  image: string;
  video_files: PexelsVideoFile[];
}

// Pick a ~HD mp4: prefer an h264 .mp4 nearest 1280px wide, else the first mp4.
function pickVideoFile(files: PexelsVideoFile[]): string | null {
  const mp4s = files.filter((f) => f.file_type === "video/mp4");
  if (mp4s.length === 0) return files[0]?.link ?? null;
  const scored = mp4s
    .map((f) => ({ f, w: f.width || 0 }))
    .sort((a, b) => Math.abs(a.w - 1280) - Math.abs(b.w - 1280));
  return scored[0].f.link;
}

const CACHE = { "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400" };

export async function GET(req: Request) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    return Response.json({ error: "search-disabled" }, { status: 501 });
  }
  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("q") ?? "").slice(0, 100);
  if (!q.trim()) {
    return Response.json({ error: "missing query" }, { status: 400 });
  }
  const page = Math.min(Math.max(1, Number(searchParams.get("page")) || 1), 20);
  const isVideo = String(searchParams.get("type") ?? "photo") === "video";

  try {
    if (isVideo) {
      const r = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=24&page=${page}&orientation=landscape`,
        { headers: { Authorization: key } },
      );
      if (!r.ok) {
        return Response.json({ error: "pexels-error" }, { status: r.status });
      }
      const data = (await r.json()) as { videos: PexelsVideo[] };
      const results = (data.videos || [])
        .map((v) => {
          const file = pickVideoFile(v.video_files || []);
          if (!file) return null;
          return {
            id: String(v.id),
            thumb: v.image,
            full: file,
            alt: "",
            photographer: v.user?.name || "",
            url: v.url,
            durationS: v.duration || 0,
          };
        })
        .filter(Boolean);
      return Response.json({ results }, { headers: CACHE });
    }

    const r = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24&page=${page}&orientation=landscape`,
      { headers: { Authorization: key } },
    );
    if (!r.ok) {
      return Response.json({ error: "pexels-error" }, { status: r.status });
    }
    const data = (await r.json()) as { photos: PexelsPhoto[] };
    const results = (data.photos || []).map((p) => ({
      id: String(p.id),
      thumb: p.src.medium,
      full: p.src.large2x || p.src.large,
      alt: p.alt || "",
      photographer: p.photographer || "",
      url: p.url,
    }));
    return Response.json({ results }, { headers: CACHE });
  } catch {
    return Response.json({ error: "fetch-failed" }, { status: 502 });
  }
}
