// BG Lab — CPU 2D-canvas engine. Draws the source, then walks the (ordered)
// effect stack applying each op in place. Preview and export call the same path.

import type { BgConfig, Dims } from "../../types";
import { unit } from "../../resolution";
import type { EngineSource, RenderEngine } from "../types";
import { ctx2d } from "./util";
import { drawTransformedSource } from "./sourceTransform";
import { drawPattern } from "./patterns";
import { OPS } from "./ops";

const DEFAULT_BG = "#cdd9e0";

export class CpuEngine implements RenderEngine {
  private src: EngineSource = null;

  setSource(src: EngineSource) {
    this.src = src;
  }

  render(target: HTMLCanvasElement, config: BgConfig, dims: Dims, time = 0) {
    target.width = dims.W;
    target.height = dims.H;
    const ctx = ctx2d(target);
    const { W, H } = dims;
    ctx.clearRect(0, 0, W, H);

    // base
    if (this.src && (this.src.kind === "image" || this.src.kind === "video")) {
      const im: CanvasImageSource =
        this.src.kind === "image" ? this.src.image : this.src.video;
      const iw = (this.src.kind === "video" ? this.src.video.videoWidth : (this.src.image.width as number)) || W;
      const ih = (this.src.kind === "video" ? this.src.video.videoHeight : (this.src.image.height as number)) || H;
      try {
        drawTransformedSource(ctx, target, im, iw, ih, W, H, config.source.transform);
      } catch {
        /* video frame not ready */
      }
    } else if (this.src && this.src.kind === "pattern") {
      drawPattern(ctx, W, H, this.src.pattern, unit(W));
    } else {
      ctx.fillStyle = this.src && this.src.kind === "solid" ? this.src.color : DEFAULT_BG;
      ctx.fillRect(0, 0, W, H);
    }

    // stack (order is semantic)
    const u = unit(W);
    for (const eff of config.stack) {
      if (!eff.enabled || !eff.type) continue;
      const op = OPS[eff.type];
      if (op) op(target, eff.params, u, time);
    }
  }

  dispose() {
    this.src = null;
  }
}
