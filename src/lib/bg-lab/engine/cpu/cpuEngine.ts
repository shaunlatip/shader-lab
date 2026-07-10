// BG Lab — CPU 2D-canvas engine. Draws the source, then walks the (ordered)
// effect stack applying each op in place. Preview and export call the same path.

import type { BgConfig, Dims } from "../../types";
import { unit } from "../../resolution";
import type { EngineSource, RenderEngine } from "../types";
import { ctx2d, tmpCanvas } from "./util";
import { drawTransformedSource } from "./sourceTransform";
import { drawPattern } from "./patterns";
import { drawGradient } from "./gradient";
import { OPS } from "./ops";

const DEFAULT_BG = "#cdd9e0";

export class CpuEngine implements RenderEngine {
  private src: EngineSource = null;
  /** Cached composited base (see render). Only ever drawImage'd from — never
   * handed to an op, so the effect stack can't mutate cached pixels. */
  private baseCanvas: HTMLCanvasElement | null = null;
  private baseSig: string | null = null;
  private baseRef: unknown = null;

  setSource(src: EngineSource) {
    this.src = src;
  }

  render(target: HTMLCanvasElement, config: BgConfig, dims: Dims, time = 0) {
    // Assigning canvas width/height resets the canvas even to the same value (HTML spec) —
    // guard it. Safe here: the explicit clearRect + full-canvas base repaint below cover it.
    if (target.width !== dims.W) target.width = dims.W;
    if (target.height !== dims.H) target.height = dims.H;
    const ctx = ctx2d(target);
    const { W, H } = dims;
    ctx.clearRect(0, 0, W, H);

    // --- base: composite source into `baseCanvas` (cached). For a static source
    // (image / pattern / solid) the composite only re-runs when the source,
    // transform, or dims change — animated stacks (grain `animate` etc.) otherwise
    // pay that cost on every rAF frame for identical pixels. Patterns especially:
    // they re-issue their whole vector draw every frame otherwise. Video always
    // recomposites (each frame differs).
    const u = unit(W);
    const isVideo = this.src?.kind === "video";
    const sig = JSON.stringify({
      k: this.src?.kind ?? "none",
      t: config.source.transform ?? null,
      p: this.src?.kind === "pattern" ? this.src.pattern : null,
      g: this.src?.kind === "gradient" ? this.src.gradient : null,
      c: this.src?.kind === "solid" ? this.src.color : null,
      W,
      H,
    });
    const ref = this.src?.kind === "image" ? this.src.image : this.src?.kind === "video" ? this.src.video : null;
    if (isVideo || sig !== this.baseSig || ref !== this.baseRef || !this.baseCanvas) {
      // tmpCanvas (not ownerDocument.createElement) so the engine also runs in
      // a worker, where the target is an OffscreenCanvas with no document.
      if (!this.baseCanvas) this.baseCanvas = tmpCanvas(target, W, H);
      if (this.baseCanvas.width !== W) this.baseCanvas.width = W;
      if (this.baseCanvas.height !== H) this.baseCanvas.height = H;
      const bctx = ctx2d(this.baseCanvas);
      bctx.clearRect(0, 0, W, H);
      if (this.src && (this.src.kind === "image" || this.src.kind === "video")) {
        const im: CanvasImageSource =
          this.src.kind === "image" ? this.src.image : this.src.video;
        const iw = (this.src.kind === "video" ? this.src.video.videoWidth : (this.src.image.width as number)) || W;
        const ih = (this.src.kind === "video" ? this.src.video.videoHeight : (this.src.image.height as number)) || H;
        try {
          drawTransformedSource(bctx, this.baseCanvas, im, iw, ih, W, H, config.source.transform);
        } catch {
          /* video frame not ready */
        }
      } else if (this.src && this.src.kind === "pattern") {
        drawPattern(bctx, W, H, this.src.pattern, u);
      } else if (this.src && this.src.kind === "gradient") {
        drawGradient(bctx, W, H, this.src.gradient);
      } else {
        bctx.fillStyle = this.src && this.src.kind === "solid" ? this.src.color : DEFAULT_BG;
        bctx.fillRect(0, 0, W, H);
      }
      this.baseSig = sig;
      this.baseRef = ref;
    }
    ctx.drawImage(this.baseCanvas, 0, 0);

    // stack (order is semantic) — runs on the target canvas; baseCanvas is never
    // passed to an op, so cached base pixels can't be mutated in place.
    for (const eff of config.stack) {
      if (!eff.enabled || !eff.type) continue;
      const op = OPS[eff.type];
      if (op) op(target, eff.params, u, time);
    }
  }

  dispose() {
    this.baseCanvas = null;
    this.baseSig = null;
    this.baseRef = null;
    this.src = null;
  }
}
