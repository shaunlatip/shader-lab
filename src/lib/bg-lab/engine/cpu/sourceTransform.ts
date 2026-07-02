// BG Lab — apply a source crop/rotate while compositing the base. Rotates/flips
// the source into an intermediate, crops a normalized rect (in rotated space),
// then cover-fits that into the output. Shared by both engines' base draw.

import type { SourceTransform } from "../../types";
import { tmpCanvas, ctx2d } from "./util";

export function drawTransformedSource(
  ctx: CanvasRenderingContext2D,
  ref: HTMLCanvasElement,
  img: CanvasImageSource,
  imgW: number,
  imgH: number,
  W: number,
  H: number,
  transform?: SourceTransform,
) {
  const rot = transform?.rotate ?? 0;
  const flip = !!transform?.flipH;

  let drawSrc: CanvasImageSource = img;
  let bW = imgW,
    bH = imgH;

  if (rot !== 0 || flip) {
    const swap = rot === 90 || rot === 270;
    bW = swap ? imgH : imgW;
    bH = swap ? imgW : imgH;
    const inter = tmpCanvas(ref, bW, bH);
    const ictx = ctx2d(inter);
    ictx.save();
    ictx.translate(bW / 2, bH / 2);
    ictx.rotate((rot * Math.PI) / 180);
    if (flip) ictx.scale(-1, 1);
    ictx.drawImage(img, -imgW / 2, -imgH / 2, imgW, imgH);
    ictx.restore();
    drawSrc = inter;
  }

  // crop rect in rotated/flipped source space (normalized → px). Clamp the
  // origin first, then derive size from the *clamped* origin so a hand-edited /
  // AI / draft crop rect can never sample past the source.
  const cr = transform?.crop;
  let sx = 0,
    sy = 0,
    sw = bW,
    sh = bH;
  if (cr && cr.w > 0 && cr.h > 0) {
    const x0 = Math.max(0, Math.min(1, cr.x));
    const y0 = Math.max(0, Math.min(1, cr.y));
    sx = x0 * bW;
    sy = y0 * bH;
    sw = Math.max(1, Math.max(0, Math.min(cr.w, 1 - x0)) * bW);
    sh = Math.max(1, Math.max(0, Math.min(cr.h, 1 - y0)) * bH);
  }

  // cover-fit the crop into W×H
  const s = Math.max(W / sw, H / sh);
  const dw = sw * s,
    dh = sh * s;
  ctx.drawImage(drawSrc, sx, sy, sw, sh, (W - dw) / 2, (H - dh) / 2, dw, dh);
}
