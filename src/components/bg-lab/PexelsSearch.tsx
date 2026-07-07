import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PEXELS_TAGS } from "@/lib/bg-lab/presets";
import { useBgLab } from "./BgLabProvider";
import { CollapsibleSection, labButton } from "./panel";

interface PexelsResult {
  id: string;
  thumb: string;
  full: string;
  alt: string;
  photographer: string;
  url: string;
  durationS?: number;
}

const DEFAULT_QUERY = "minimal landscape";
const PER_PAGE = 24; // matches the API route

export function PexelsSearch({ kind = "photo" }: { kind?: "photo" | "video" }) {
  const { dispatch } = useBgLab();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PexelsResult[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "more" | "disabled" | "error" | "done">("idle");
  const [hasMore, setHasMore] = useState(false);

  const active = useRef({ query: DEFAULT_QUERY, page: 0 });
  const seeded = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (query: string, page: number, append: boolean) => {
    if (!query.trim()) return;
    setState(append ? "more" : "loading");
    try {
      const r = await fetch(`/api/pexels?q=${encodeURIComponent(query)}&page=${page}&type=${kind}`);
      if (r.status === 501) {
        setState("disabled");
        return;
      }
      if (!r.ok) {
        setState("error");
        return;
      }
      const data = (await r.json()) as { results: PexelsResult[] };
      const items = data.results || [];
      active.current = { query, page };
      setHasMore(items.length >= PER_PAGE);
      setResults((prev) => {
        if (!append) return items;
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...items.filter((p) => !seen.has(p.id))];
      });
      setState("done");
    } catch {
      setState("error");
    }
  }, [kind]);

  // Seed on mount and re-seed when switching photo↔video.
  useEffect(() => {
    seeded.current = true;
    setResults([]);
    run(DEFAULT_QUERY, 1, false);
  }, [run]);

  // Infinite scroll — load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && state === "done") {
          run(active.current.query, active.current.page + 1, true);
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, state, run]);

  function search(query: string) {
    setQ(query);
    run(query, 1, false);
  }

  return (
    <CollapsibleSection title="Pexels" defaultOpen>
      <div className="flex flex-col gap-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(q, 1, false);
          }}
          className="flex gap-1.5"
        >
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Pexels…" className="h-8 text-xs" />
          <Button type="submit" variant="outline" size="icon-sm" aria-label="Search" className={labButton}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </form>

        {/* Suggested queries — single-row horizontal scroll, no wrap. */}
        <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {PEXELS_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => search(tag)}
              className="shrink-0 whitespace-nowrap rounded-full border border-border-default px-2.5 py-0.5 text-[11px] text-text-secondary transition-[transform,color,border-color] duration-150 ease-out hover:border-border-strong hover:text-text-primary motion-safe:active:scale-[0.95]"
            >
              {tag}
            </button>
          ))}
        </div>

        {state === "loading" && <p className="text-[11px] text-text-secondary">Searching…</p>}
        {state === "disabled" && (
          <p className="text-[11px] leading-snug text-text-secondary">
            Pexels search isn’t configured (no API key). Gallery + upload still work.
          </p>
        )}
        {state === "error" && <p className="text-[11px] text-text-secondary">Search failed — try again.</p>}

        {results.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-1.5">
              {results.map((r) => (
                <Tooltip key={r.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() =>
                        dispatch({
                          t: "setSource",
                          patch:
                            kind === "video"
                              ? { mode: "video", imageId: `pexels:video:${r.full}` }
                              : { mode: "image", imageId: `pexels:${r.full}` },
                        })
                      }
                      className="group relative aspect-square overflow-hidden rounded-control border-2 border-transparent transition-[transform,border-color] duration-150 ease-out hover:border-border-strong motion-safe:active:scale-[0.96]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.thumb}
                        alt={r.alt}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.06]"
                      />
                      {kind === "video" && (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
                            <Play className="h-3 w-3 translate-x-[1px]" fill="currentColor" />
                          </span>
                        </span>
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="lab-chrome font-lab max-w-[200px]">
                    {r.alt ? `${r.alt} — ` : ""}
                    <span className="text-canvas/70">{r.photographer || "Pexels"}</span>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* infinite-scroll sentinel */}
            <div ref={sentinelRef} className="h-1" aria-hidden />
            {state === "more" && <p className="text-center text-[11px] text-text-secondary">Loading more…</p>}
            <p className="text-[10px] text-text-secondary">
              {kind === "video" ? "Videos" : "Photos"} via Pexels — free to use, credit appreciated.
            </p>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
