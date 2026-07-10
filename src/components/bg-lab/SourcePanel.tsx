import { useRef, useState } from "react";
import { toast } from "sonner";
import { Crop, Shuffle, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GALLERY, TEXTURES, isTextureId, randomGalleryId, randomPexelsId } from "@/lib/bg-lab/presets";
import type { SourceState } from "@/lib/bg-lab/types";
import { useBgLab } from "./BgLabProvider";
import { PexelsSearch } from "./PexelsSearch";
import { SolidColorPanel } from "./SolidColorPanel";
import { PatternPanel } from "./PatternPanel";
import { GradientPanel } from "./GradientPanel";
import { CropRotate } from "./CropRotate";
import { CollapsibleSection, labButton } from "./panel";

// Top-level Source tabs. Gradient/Pattern/Texture are consolidated under one
// "Generated" tab with its own sub-switcher — three continuous-field / studio
// source registers that don't need their own top-level slot, unlike Image
// (your own photos) and Video. Solid stays top-level (the simplest, most-used
// fallback). Both tabs are DERIVED from `source`, never separate state, so
// there's nothing to desync on reload/undo/paste.
type TopTab = "image" | "video" | "generated" | "solid";
type GenTab = "gradient" | "pattern" | "texture";

const GEN_TAB_LABEL: Record<GenTab, string> = { gradient: "Gradient", pattern: "Pattern", texture: "Texture" };

function topTabFor(source: SourceState): TopTab {
  if (source.mode === "gradient" || source.mode === "pattern") return "generated";
  if (source.mode === "image" && isTextureId(source.imageId)) return "generated";
  if (source.mode === "video") return "video";
  if (source.mode === "solid") return "solid";
  return "image";
}

function genTabFor(source: SourceState): GenTab {
  if (source.mode === "pattern") return "pattern";
  if (source.mode === "image") return "texture";
  return "gradient";
}

export function SourcePanel() {
  const { config, dispatch } = useBgLab();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [randomizing, setRandomizing] = useState(false);
  const { source } = config;
  const topTab = topTabFor(source);
  const genTab = genTabFor(source);
  // Crop/random row is Image/Video-tab furniture — Texture also sets
  // mode:"image" but lives under Generated, so gate on the top tab, not mode.
  const hasMedia = (topTab === "image" || topTab === "video") && !!source.imageId;
  const transformed = !!source.transform && (source.transform.rotate || source.transform.flipH || source.transform.crop);

  function handleTopTabChange(v: string) {
    const next = v as TopTab;
    if (next === "generated") {
      // Only fires on actual entry (Radix skips onValueChange when the value
      // doesn't change), so this can't stomp an in-progress Pattern/Texture
      // pick — it only runs when arriving from Image/Video/Solid.
      dispatch({ t: "setSource", patch: { mode: "gradient" } });
      return;
    }
    if (next === "image" && isTextureId(source.imageId)) {
      // Escaping Generated→Texture: Texture ALSO uses mode:"image", so a bare
      // {mode:"image"} patch is a no-op here (already the mode) and topTabFor
      // would keep classifying this as Generated. Clear the pick so it
      // actually lands on the plain photo gallery.
      dispatch({ t: "setSource", patch: { mode: "image", imageId: null } });
      return;
    }
    dispatch({ t: "setSource", patch: { mode: next } });
  }

  function handleGenTabChange(next: GenTab) {
    if (next === genTab) return;
    if (next === "pattern") dispatch({ t: "setSource", patch: { mode: "pattern" } });
    else if (next === "gradient") dispatch({ t: "setSource", patch: { mode: "gradient" } });
    else {
      const keep = isTextureId(source.imageId) ? source.imageId : (TEXTURES[0]?.id ?? null);
      dispatch({ t: "setSource", patch: { mode: "image", imageId: keep } });
    }
  }

  function onUpload(e: React.ChangeEvent<HTMLInputElement>, mode: "image" | "video") {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    dispatch({ t: "setSource", patch: { mode, imageId: url } });
  }

  // Scoped randomize: only swaps the source for the active tab (the stack is
  // untouched — random preset lives in the Presets section, random color /
  // pattern in their own panels).
  async function randomizeSource() {
    const mode = source.mode as "image" | "video";
    setRandomizing(true);
    try {
      const id = await randomPexelsId(mode === "video" ? "video" : "photo");
      if (id) {
        dispatch({ t: "setSource", patch: { mode, imageId: id } });
      } else if (mode === "image") {
        dispatch({ t: "setSource", patch: { mode, imageId: randomGalleryId() } }); // offline fallback
      } else {
        toast.error("Couldn't fetch a random video", { description: "Pexels search isn't available right now." });
      }
    } finally {
      setRandomizing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <Tabs value={topTab} onValueChange={handleTopTabChange}>
        <TabsList className="w-full">
          <TabsTrigger value="image" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Image
          </TabsTrigger>
          <TabsTrigger value="video" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Video
          </TabsTrigger>
          <TabsTrigger value="generated" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Generated
          </TabsTrigger>
          <TabsTrigger value="solid" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Solid
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {topTab === "generated" && (
        <div className="flex items-center gap-0.5 self-start rounded-full bg-surface-active p-0.5 text-[11px] font-medium">
          {(["gradient", "pattern", "texture"] as GenTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => handleGenTabChange(tab)}
              className={cn(
                "rounded-full px-2.5 py-1 transition-colors",
                genTab === tab
                  ? "bg-canvas text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {GEN_TAB_LABEL[tab]}
            </button>
          ))}
        </div>
      )}

      {(topTab === "image" || topTab === "video") && (
        <div className="flex gap-1.5">
          <button
            type="button"
            disabled={randomizing}
            onClick={randomizeSource}
            className={cn(labButton, "flex h-8 flex-1 items-center justify-center gap-2 rounded-control text-[12px] disabled:opacity-60")}
          >
            <Shuffle className="h-3.5 w-3.5" />
            {randomizing ? "Rolling…" : topTab === "video" ? "Random video" : "Random image"}
          </button>
          {hasMedia && (
            <button
              type="button"
              onClick={() => setCropOpen(true)}
              className={cn(labButton, "flex h-8 flex-1 items-center justify-center gap-2 rounded-control text-[12px]")}
            >
              <Crop className="h-3.5 w-3.5" /> Crop{transformed ? " ·" : ""}
            </button>
          )}
        </div>
      )}
      {cropOpen && <CropRotate onClose={() => setCropOpen(false)} />}

      {topTab === "generated" && genTab === "gradient" && <GradientPanel />}
      {topTab === "generated" && genTab === "pattern" && <PatternPanel />}
      {topTab === "solid" && <SolidColorPanel />}

      {topTab === "generated" && genTab === "texture" && (
        <CollapsibleSection title="Texture" defaultOpen>
          <p className="mb-2 text-[11px] leading-snug text-text-secondary">
            Real scanned material. Retint with the Warm paper / Cool plaster presets (Surface category).
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {TEXTURES.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.label}
                onClick={() => dispatch({ t: "setSource", patch: { mode: "image", imageId: g.id } })}
                className={cn(
                  "group aspect-square overflow-hidden rounded-control border-2 transition-[transform,border-color] duration-150 ease-out motion-safe:active:scale-[0.96]",
                  source.imageId === g.id
                    ? "border-text-primary"
                    : "border-transparent hover:border-border-strong",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.url}
                  alt={g.label}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.06]"
                />
              </button>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {topTab === "image" && (
        <>
          {/* Your image first: this is a tool for the user's own assets.
              Starters exist so a first render is one click away. */}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-9 items-center justify-center gap-2 rounded-control border border-border-default bg-canvas text-[13px] text-text-primary shadow-xs transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover"
          >
            <Upload className="h-3.5 w-3.5" /> Upload image
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onUpload(e, "image")} />

          <PexelsSearch kind="photo" />

          <CollapsibleSection title="Starters" defaultOpen>
            <div className="grid grid-cols-3 gap-1.5">
              {GALLERY.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  title={g.label}
                  onClick={() => dispatch({ t: "setSource", patch: { imageId: g.id } })}
                  className={cn(
                    "group aspect-square overflow-hidden rounded-control border-2 transition-[transform,border-color] duration-150 ease-out motion-safe:active:scale-[0.96]",
                    source.imageId === g.id
                      ? "border-text-primary"
                      : "border-transparent hover:border-border-strong",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={g.url}
                    alt={g.label}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 ease-out motion-safe:group-hover:scale-[1.06]"
                  />
                </button>
              ))}
            </div>
          </CollapsibleSection>
        </>
      )}

      {topTab === "video" && (
        <>
          <button
            type="button"
            onClick={() => videoRef.current?.click()}
            className="flex h-9 items-center justify-center gap-2 rounded-control border border-border-default bg-canvas text-[13px] text-text-primary transition-colors hover:border-border-strong"
          >
            <Upload className="h-3.5 w-3.5" /> Upload video
          </button>
          <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => onUpload(e, "video")} />
          <PexelsSearch kind="video" />
        </>
      )}
    </section>
  );
}
