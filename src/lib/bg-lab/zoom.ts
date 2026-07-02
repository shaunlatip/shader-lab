// BG Lab — view (zoom/pan) math. Purely a CSS view transform on the canvas;
// it never changes render resolution, so it costs nothing per frame.

export const ZMIN = 0.1;
export const ZMAX = 8;
export const clampZoom = (z: number) => Math.min(ZMAX, Math.max(ZMIN, z));

export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

export const IDENTITY: View = { zoom: 1, panX: 0, panY: 0 };

/** zoom by `factor` keeping the point (cx,cy) — relative to the transform origin
 *  (stage center) — fixed on screen */
export function zoomToward(v: View, factor: number, cx: number, cy: number): View {
  const zoom = clampZoom(v.zoom * factor);
  const k = zoom / v.zoom;
  return {
    zoom,
    panX: cx - (cx - v.panX) * k,
    panY: cy - (cy - v.panY) * k,
  };
}

/** fit scale so a (cw×ch) canvas fits inside a (bw×bh) box with padding */
export function fitZoom(cw: number, ch: number, bw: number, bh: number, pad = 48): number {
  if (!cw || !ch) return 1;
  return clampZoom(Math.min((bw - pad) / cw, (bh - pad) / ch));
}
