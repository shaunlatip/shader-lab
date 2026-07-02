import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, RotateCw, FlipHorizontal2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { drawTransformedSource } from "@/lib/bg-lab/engine/cpu/sourceTransform";
import { useBgLab } from "./BgLabProvider";
import { useEngineSource } from "./SourceProvider";
import { labButton } from "./panel";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const PREVIEW_W = 520;

const RATIOS: { id: string; r: number | null }[] = [
  { id: "Full", r: null },
  { id: "1:1", r: 1 },
  { id: "4:5", r: 4 / 5 },
  { id: "3:4", r: 3 / 4 },
  { id: "9:16", r: 9 / 16 },
  { id: "16:9", r: 16 / 9 },
  { id: "4:3", r: 4 / 3 },
  { id: "3:2", r: 3 / 2 },
];

/** Centered crop rect (normalized, rotated-source space) for a target output
 * ratio R, given the rotated-source aspect and a fill `size`. */
function rectFor(R: number | null, aspect: number, size: number, cx: number, cy: number) {
  if (R == null) return { x: 0, y: 0, w: 1, h: 1 };
  const ar = R / aspect; // crop's normalized w/h to hit screen ratio R
  let w: number, h: number;
  if (ar >= 1) {
    w = size;
    h = size / ar;
  } else {
    h = size;
    w = size * ar;
  }
  w = Math.min(1, w);
  h = Math.min(1, h);
  const x = clamp01(cx - w / 2);
  const y = clamp01(cy - h / 2);
  return { x: Math.min(x, 1 - w), y: Math.min(y, 1 - h), w, h };
}

export function CropRotate({ onClose }: { onClose: () => void }) {
  const { config, dispatch } = useBgLab();
  const { engineSource } = useEngineSource();
  const init = config.source.transform ?? {};
  const [rotate, setRotate] = useState<0 | 90 | 180 | 270>(init.rotate ?? 0);
  const [flipH, setFlipH] = useState(!!init.flipH);
  const [ratio, setRatio] = useState<number | null>(null);
  const [size, setSize] = useState(init.crop ? Math.max(init.crop.w, init.crop.h) : 1);
  const [center, setCenter] = useState({ cx: init.crop ? init.crop.x + init.crop.w / 2 : 0.5, cy: init.crop ? init.crop.y + init.crop.h / 2 : 0.5 });
  // Until the user changes a crop control, keep the existing saved crop exactly
  // (we can't perfectly reverse-engineer ratio from an arbitrary rect).
  const [touched, setTouched] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const media: CanvasImageSource | null =
    engineSource?.kind === "image" ? engineSource.image : engineSource?.kind === "video" ? engineSource.video : null;
  const dims = useMemo(() => {
    if (engineSource?.kind === "image") return { w: (engineSource.image.width as number) || 16, h: (engineSource.image.height as number) || 9 };
    if (engineSource?.kind === "video") return { w: engineSource.video.videoWidth || 16, h: engineSource.video.videoHeight || 9 };
    return { w: 16, h: 9 };
  }, [engineSource]);

  const swap = rotate === 90 || rotate === 270;
  const rotAspect = (swap ? dims.h : dims.w) / (swap ? dims.w : dims.h);
  const PW = PREVIEW_W;
  const PH = Math.round(PW / Math.max(0.2, rotAspect));

  const crop = touched ? rectFor(ratio, rotAspect, size, center.cx, center.cy) : init.crop ?? { x: 0, y: 0, w: 1, h: 1 };

  // draw the rotated/flipped (uncropped) source into the preview canvas
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !media) return;
    cv.width = PW;
    cv.height = PH;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, PW, PH);
    try {
      drawTransformedSource(ctx, cv, media, dims.w, dims.h, PW, PH, { rotate, flipH });
    } catch {
      /* video not ready */
    }
  }, [media, dims.w, dims.h, rotate, flipH, PW, PH]);

  // drag the crop rect to reposition
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: center.cx, cy: center.cy };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setTouched(true);
    setCenter({ cx: clamp01(d.cx + (e.clientX - d.x) / PW), cy: clamp01(d.cy + (e.clientY - d.y) / PH) });
  };
  const onUp = () => (drag.current = null);

  const save = () => {
    const t: NonNullable<typeof config.source.transform> = {};
    if (rotate !== 0) t.rotate = rotate;
    if (flipH) t.flipH = true;
    if (!(crop.x === 0 && crop.y === 0 && crop.w === 1 && crop.h === 1)) t.crop = crop;
    dispatch({ t: "setSource", patch: { transform: Object.keys(t).length ? t : undefined } });
    onClose();
  };
  const reset = () => {
    setTouched(true);
    setRotate(0);
    setFlipH(false);
    setRatio(null);
    setSize(1);
    setCenter({ cx: 0.5, cy: 0.5 });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="lab-chrome font-lab flex max-h-full flex-col gap-3 rounded-lg border border-border-default bg-canvas p-4 text-text-primary shadow-5"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[14px] font-medium">Crop &amp; rotate</h2>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" className={labButton} aria-label="Rotate left" onClick={() => setRotate(((rotate + 270) % 360) as 0 | 90 | 180 | 270)}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon-sm" className={labButton} aria-label="Rotate right" onClick={() => setRotate(((rotate + 90) % 360) as 0 | 90 | 180 | 270)}>
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon-sm" className={cn(labButton, flipH && "border-text-primary")} aria-label="Flip horizontal" onClick={() => setFlipH((f) => !f)}>
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* preview + crop overlay */}
        <div ref={boxRef} className="relative mx-auto overflow-hidden rounded-md bg-shade-10" style={{ width: PW, height: PH }}>
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          <div
            onPointerDown={ratio == null ? undefined : onDown}
            onPointerMove={ratio == null ? undefined : onMove}
            onPointerUp={ratio == null ? undefined : onUp}
            onPointerLeave={ratio == null ? undefined : onUp}
            className={cn("absolute border border-white/90", ratio == null ? "pointer-events-none" : "cursor-move")}
            style={{
              left: crop.x * PW,
              top: crop.y * PH,
              width: crop.w * PW,
              height: crop.h * PH,
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.5)",
            }}
          />
        </div>

        {/* ratio presets */}
        <div className="flex flex-wrap gap-1.5">
          {RATIOS.map((rr) => (
            <button
              key={rr.id}
              type="button"
              onClick={() => {
                setTouched(true);
                setRatio(rr.r);
                if (rr.r == null) setSize(1);
                else if (size >= 1) setSize(0.9);
              }}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                ratio === rr.r ? "border-text-primary text-text-primary" : "border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary",
              )}
            >
              {rr.id}
            </button>
          ))}
        </div>

        {ratio != null && (
          <div className="grid grid-cols-[52px_1fr] items-center gap-2">
            <span className="text-[11px] text-text-secondary">Size</span>
            <input
              type="range"
              min={0.3}
              max={1}
              step={0.01}
              value={size}
              onChange={(e) => {
                setTouched(true);
                setSize(Number(e.target.value));
              }}
              className="h-1 w-full cursor-pointer accent-accent"
            />
          </div>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <button type="button" onClick={reset} className="text-[12px] text-text-secondary transition-colors hover:text-text-primary">
            Reset
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className={labButton} onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" className="bg-text-primary text-canvas hover:bg-text-primary/90" onClick={save}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
