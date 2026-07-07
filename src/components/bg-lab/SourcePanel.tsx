import { useRef, useState } from "react";
import { Crop, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GALLERY, inspire } from "@/lib/bg-lab/presets";
import { useBgLab } from "./BgLabProvider";
import { PexelsSearch } from "./PexelsSearch";
import { SolidColorPanel } from "./SolidColorPanel";
import { PatternPanel } from "./PatternPanel";
import { CropRotate } from "./CropRotate";
import { CollapsibleSection, labButton } from "./panel";

export function SourcePanel() {
  const { config, dispatch } = useBgLab();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const { source } = config;
  const hasMedia = (source.mode === "image" || source.mode === "video") && !!source.imageId;
  // pattern mode never shows crop UI
  const transformed = !!source.transform && (source.transform.rotate || source.transform.flipH || source.transform.crop);

  function onUpload(e: React.ChangeEvent<HTMLInputElement>, mode: "image" | "video") {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    dispatch({ t: "setSource", patch: { mode, imageId: url } });
  }

  return (
    <section className="flex flex-col gap-4">
      <Tabs
        value={source.mode}
        onValueChange={(v) => dispatch({ t: "setSource", patch: { mode: v as "image" | "video" | "solid" | "pattern" } })}
      >
        <TabsList className="w-full">
          <TabsTrigger value="image" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Image
          </TabsTrigger>
          <TabsTrigger value="video" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Video
          </TabsTrigger>
          <TabsTrigger value="solid" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Solid
          </TabsTrigger>
          <TabsTrigger value="pattern" className="flex-1 data-[state=inactive]:hover:text-text-primary">
            Pattern
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => dispatch({ t: "replace", config: inspire() })}
          className={cn(labButton, "flex h-8 flex-1 items-center justify-center gap-2 rounded-control text-[12px]")}
        >
          <Sparkles className="h-3.5 w-3.5" /> Inspire me
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
      {cropOpen && <CropRotate onClose={() => setCropOpen(false)} />}

      {source.mode === "solid" && <SolidColorPanel />}
      {source.mode === "pattern" && <PatternPanel />}

      {source.mode === "image" && (
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

      {source.mode === "video" && (
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
