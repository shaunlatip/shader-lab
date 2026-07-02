declare module "gifenc" {
  export interface GifWriteFrameOpts {
    palette?: number[][];
    delay?: number;
    transparent?: boolean;
    dispose?: number;
  }
  export interface GifEncoderInstance {
    writeFrame: (index: Uint8Array, width: number, height: number, opts?: GifWriteFrameOpts) => void;
    finish: () => void;
    bytes: () => Uint8Array;
    bytesView: () => Uint8Array;
  }
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: string; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): number[][];
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: string,
  ): Uint8Array;
}
