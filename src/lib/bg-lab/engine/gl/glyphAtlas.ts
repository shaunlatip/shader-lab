// BG Lab — glyph atlas builder for the GPU glyph pass (shaders.ts `glyphs`).
// Renders every glyph in a ramp into a fixed-grid canvas atlas so the shader
// can sample a glyph's coverage the same way `renderGlyph` (cpu/converters.ts)
// stamps it with fillText — same font string, same white-on-transparent
// approach (renderGlyph draws in `ink`/source color; the atlas stays neutral
// white so the shader can tint it after sampling .a).
//
// Fixed grid: every cell is the same size (ceil(fontPx*1.4), glyph + padding)
// so the shader can index a cell with pure integer math (no per-glyph metrics
// table needed) — cols/rows chosen to keep the atlas roughly square.

export interface GlyphAtlas {
  canvas: HTMLCanvasElement;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
}

/** Build a white-glyphs-on-transparent atlas for `glyphs`, one cell per glyph,
 * fontPx MUST match the font size renderGlyph would use on screen (see the GL
 * pass's fontPxQ quantization) so rasterization matches CPU fillText output. */
export function buildGlyphAtlas(glyphs: string[], fontPx: number): GlyphAtlas {
  const N = Math.max(1, glyphs.length);
  const cellW = Math.ceil(fontPx * 1.4);
  const cellH = cellW;
  const cols = Math.ceil(Math.sqrt(N));
  const rows = Math.ceil(N / cols);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, cols * cellW);
  canvas.height = Math.max(1, rows * cellH);
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `${fontPx}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let i = 0; i < N; i++) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const x = cx * cellW + cellW / 2;
    const y = cy * cellH + cellH / 2;
    const g = glyphs[i];
    if (g === " ") continue; // space glyph: leave the cell fully transparent
    ctx.fillText(g, x, y);
  }

  return { canvas, cols, rows, cellW, cellH };
}
