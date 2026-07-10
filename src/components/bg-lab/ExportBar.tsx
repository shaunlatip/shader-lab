import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASPECTS, outputDims } from "@/lib/bg-lab/resolution";
import { useExport, type ClipFormat, type SequenceFormat, type StillFormat } from "@/hooks/useExport";
import { useBgLab } from "./BgLabProvider";
import { useEngineSource } from "./SourceProvider";
import { CollapsibleSection } from "./panel";

// Shared label column so Aspect / Ratio / Size line up.
const ROW = "grid grid-cols-[52px_1fr] items-center gap-2";
const LABEL = "text-[11px] text-text-secondary";

type Format = StillFormat | ClipFormat | SequenceFormat;
const SELECT_CONTENT = "lab-chrome font-lab border-border-default bg-canvas text-text-primary";
const SELECT_ITEM = "text-xs focus:bg-canvas-inverted/10 focus:text-text-primary";

export function ExportBar() {
  const { config, dispatch } = useBgLab();
  const { engineSource } = useEngineSource();
  const { exporting, progress, exportStill, exportClip, exportSequence } = useExport();
  const { aspect, longEdge } = config.output;
  const isCustom = typeof aspect !== "string";
  const dims = outputDims(aspect, longEdge);

  const [format, setFormat] = useState<Format>("png");
  const [scale, setScale] = useState(1);
  const [fps, setFps] = useState(30);
  const isClip = format === "mp4" || format === "gif";
  const isSeq = format === "pngseq";

  // Default the format to the source kind (video→mp4, image/solid→png), but only
  // when the current pick is wrong for the new kind — never override a manual
  // choice within a kind. Key off config.source.mode (immediate) rather than the
  // resolved engineSource, which lags while a new source loads.
  const sourceMode = config.source.mode;
  useEffect(() => {
    setFormat((f) => {
      const clip = f === "mp4" || f === "gif";
      if (sourceMode === "video" && !clip) return "mp4";
      if (sourceMode !== "video" && clip) return "png";
      return f;
    });
  }, [sourceMode]);

  function run() {
    const cb = {
      onError: (m: string) => toast.error(m),
      onDone: (n: string) => toast.success("Exported", { description: n }),
    };
    if (isSeq) exportSequence(config, engineSource, { fps, scale }, cb);
    else if (isClip) exportClip(config, engineSource, { format: format as ClipFormat, fps, scale }, cb);
    else exportStill(config, engineSource, { format: format as StillFormat, scale }, cb);
  }

  // `progress` is a real 0..1 signal for every export kind now (stills drive
  // an honest synthetic ramp — see useExport) so the % is always meaningful,
  // not just for clip/sequence.
  const pct = Math.round(progress * 100);
  const verb = isSeq ? "Rendering" : isClip ? "Encoding" : "Exporting";
  const label = exporting ? `${verb}… ${pct}%` : isSeq ? "Export PNG sequence" : `Export ${format.toUpperCase()}`;

  return (
    <div className="border-t border-border-default bg-canvas p-3">
      <CollapsibleSection title="Export" defaultOpen={false} reverse>
        <div className="flex flex-col gap-2.5">
      <div className={ROW}>
        <span className={LABEL}>Aspect</span>
        <Select
          value={isCustom ? "custom" : aspect}
          onValueChange={(v) =>
            dispatch({ t: "setOutput", patch: { aspect: v === "custom" ? { w: 3, h: 2 } : (v as typeof aspect) } })
          }
        >
          <SelectTrigger size="sm" className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="lab-chrome font-lab border-border-default bg-canvas text-text-primary">
            {ASPECTS.map((a) => (
              <SelectItem key={a.id} value={a.id} className="text-xs focus:bg-canvas-inverted/10 focus:text-text-primary">
                {a.label}
              </SelectItem>
            ))}
            <SelectItem value="custom" className="text-xs focus:bg-canvas-inverted/10 focus:text-text-primary">
              Custom…
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isCustom && (
        <div className={ROW}>
          <span className={LABEL}>Ratio</span>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={1}
              value={aspect.w}
              onChange={(e) => dispatch({ t: "setOutput", patch: { aspect: { ...aspect, w: Number(e.target.value) || 1 } } })}
              className="h-8 w-full text-xs"
              aria-label="Ratio width"
            />
            <span className="text-text-secondary">:</span>
            <Input
              type="number"
              min={1}
              value={aspect.h}
              onChange={(e) => dispatch({ t: "setOutput", patch: { aspect: { ...aspect, h: Number(e.target.value) || 1 } } })}
              className="h-8 w-full text-xs"
              aria-label="Ratio height"
            />
          </div>
        </div>
      )}

      <div className={ROW}>
        <span className={LABEL}>Size</span>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              type="number"
              min={200}
              max={6000}
              step={100}
              value={longEdge}
              onChange={(e) => dispatch({ t: "setOutput", patch: { longEdge: Number(e.target.value) || 2000 } })}
              className="h-8 w-full pr-7 text-xs"
              aria-label="Long edge (px)"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-text-secondary">
              px
            </span>
          </div>
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-text-secondary">
            {dims.W} × {dims.H}
          </span>
        </div>
      </div>

      <div className={ROW}>
        <span className={LABEL}>Format</span>
        <Select value={format} onValueChange={(v) => setFormat(v as Format)}>
          <SelectTrigger size="sm" className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT}>
            <SelectItem value="png" className={SELECT_ITEM}>PNG</SelectItem>
            <SelectItem value="jpg" className={SELECT_ITEM}>JPG</SelectItem>
            <SelectItem value="mp4" className={SELECT_ITEM}>MP4 (video)</SelectItem>
            <SelectItem value="gif" className={SELECT_ITEM}>GIF (video)</SelectItem>
            <SelectItem value="pngseq" className={SELECT_ITEM}>PNG sequence (.zip)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className={ROW}>
        <span className={LABEL}>Scale</span>
        <Select value={String(scale)} onValueChange={(v) => setScale(Number(v))}>
          <SelectTrigger size="sm" className="h-8 w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT}>
            {[1, 2, 3, 4].map((s) => {
              const d = outputDims(aspect, longEdge * s);
              return (
                <SelectItem key={s} value={String(s)} className={SELECT_ITEM}>
                  {s}× · {d.W}×{d.H}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {(isClip || isSeq) && (
        <div className={ROW}>
          <span className={LABEL}>FPS</span>
          <Input
            type="number"
            min={6}
            max={60}
            step={1}
            value={fps}
            onChange={(e) => setFps(Math.min(60, Math.max(6, Number(e.target.value) || 30)))}
            className="h-8 w-full text-xs"
            aria-label="Frames per second"
          />
        </div>
      )}

      {isClip && (
        <p className="text-[10px] leading-snug text-text-secondary">
          {engineSource?.kind === "video"
            ? "Renders every frame of the clip (≤ 30s, ≤ 1080p)."
            : "Exports a 3s loop of the animated effects."}
        </p>
      )}
      {isSeq && (
        <p className="text-[10px] leading-snug text-text-secondary">
          A 3s PNG frame sequence (.zip) at full resolution — feed to the ffmpeg
          alpha pipeline for VP9/HEVC-alpha video (see docs/alpha-video.md).
        </p>
      )}

      <Button
        type="button"
        disabled={exporting}
        // The one emphasized CTA — solid dark on the light panel. While
        // exporting, a translucent overlay fills left→right with progress;
        // it's `bg-canvas` (the button's own opposite-extreme token) so it
        // stays theme-correct without a new color, and the label keeps its
        // normal bg-text-primary/text-canvas contrast the whole time since
        // the base layer underneath never changes.
        className="relative mt-0.5 h-9 w-full overflow-hidden bg-text-primary text-canvas transition-[transform,background-color] duration-150 hover:bg-text-primary/90 active:scale-[0.99]"
        onClick={run}
      >
        {exporting && (
          <div
            className="absolute inset-y-0 left-0 bg-canvas/15 transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
        <span className="relative z-10 inline-flex items-center">
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </span>
      </Button>
        </div>
      </CollapsibleSection>
    </div>
  );
}
