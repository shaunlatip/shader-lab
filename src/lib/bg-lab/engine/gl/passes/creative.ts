// BG Lab GL passes — creative-medium family: receipt, flutedGlass, ledPanel,
// crochet. Moved verbatim from shaders.ts.

import { pb, pn, ps } from "../../cpu/util";
import { type GpuPass, col, f, loc } from "../common";

// ---------------------------------------------------------------- receipt
// GPU accelerator for the CPU `receipt` op (ops.ts) — the two implement ONE
// spec: thermal-printer scanline bars. period = max(2,round(size*u)) px;
// band = floor(y/period); bandCenterRow = an INTEGER row (NEAREST sample of
// the source at (x, bandCenterRow), luma601 -> coverage -> pow(contrast) ink
// area for this column); bar SDF in px vs a 1px linear aaCov ramp — the same
// AA formula as halftone's aaCov (see that block comment), defined locally
// here since aaCov lives inside halftone's frag, not HEADER.
export const receipt: GpuPass = {
  frag: f(`uniform float u_period; uniform float u_contrast; uniform vec3 u_ink; uniform vec3 u_paper;
// 1px linear area ramp on an SDF in PX units — same formula as halftone's aaCov.
float aaCov(float dPx){ return clamp(0.5 - dPx, 0.0, 1.0); }
void main(){
  vec2 P = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;   // canvas px, top-left origin
  float x = floor(P.x), y = floor(P.y);
  float band = floor(y / u_period);
  float bandCenterRow = min(u_dims.y - 1.0, floor(band * u_period + u_period * 0.5));
  vec2 idx = clamp(vec2(x, bandCenterRow), vec2(0.0), u_dims - 1.0);
  vec3 src = texture(u_tex, vec2((idx.x+0.5)/u_dims.x, 1.0 - (idx.y+0.5)/u_dims.y)).rgb;
  float lum = luma601(src);
  float cov = pow(clamp(1.0 - lum, 0.0, 1.0), u_contrast);
  float barCenterY = band * u_period + u_period * 0.5 - 0.5;
  float dPx = abs(y - barCenterY) - cov * u_period * 0.5;
  float mask = aaCov(dPx);
  o = vec4(mix(u_paper, u_ink, mask), 1.0);
}`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_period"), Math.max(2, Math.round(pn(p, "size", 5) * u)));
    gl.uniform1f(loc(gl, prog, "u_contrast"), pn(p, "contrast", 1.2));
    gl.uniform3fv(loc(gl, prog, "u_ink"), col(p, "ink", "#1a1a1a"));
    gl.uniform3fv(loc(gl, prog, "u_paper"), col(p, "paper", "#f6f3ea"));
  },
};

// ---------------------------------------------------------------- flutedGlass
// GPU accelerator for the CPU `flutedGlass` op (ops.ts) — the two implement
// ONE spec: vertical reeded-glass ribs. w = max(2,round(size*u)); integer rib
// index via floor + integer mod; refraction dx = sin(t*PI)*amount*w*0.6 is
// continuous (bounded sin, allowed per the parity doctrine); the source
// sample is a MANUAL 2-tap horizontal bilinear (floor/ceil + explicit mix by
// fract) — never hardware LINEAR, since its interpolant quantizes
// differently per GPU and would break preview==export. Specular is an
// additive cos^24 lobe, same formula both sides.
export const flutedGlass: GpuPass = {
  frag: f(`uniform float u_w; uniform float u_amount; uniform float u_specular;
vec3 readNearest(float xi, float y){
  float cx = clamp(xi, 0.0, u_dims.x - 1.0);
  float cy = clamp(y,  0.0, u_dims.y - 1.0);
  return texture(u_tex, vec2((cx+0.5)/u_dims.x, 1.0 - (cy+0.5)/u_dims.y)).rgb;
}
void main(){
  vec2 P = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;   // canvas px, top-left origin
  float x = floor(P.x), y = floor(P.y);
  float xi = floor(x);
  float ribX = xi - u_w * floor(xi / u_w);        // integer mod
  float t = (ribX + 0.5) / u_w - 0.5;              // in [-0.5, 0.5)
  float dx = sin(t * 3.14159265) * u_amount * u_w * 0.6;
  float sx = x + dx;
  float x0 = floor(sx);
  float frac = sx - x0;
  // manual 2-tap horizontal bilinear — NOT hardware LINEAR (see block comment)
  vec3 a = readNearest(x0, y);
  vec3 b = readNearest(x0 + 1.0, y);
  vec3 sampled = mix(a, b, frac);
  float h = u_specular * pow(max(cos(3.14159265 * (t - 0.15)), 0.0), 24.0);
  o = vec4(clamp(sampled + h, 0.0, 1.0), 1.0);
}`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_w"), Math.max(2, Math.round(pn(p, "size", 18) * u)));
    gl.uniform1f(loc(gl, prog, "u_amount"), pn(p, "amount", 0.5));
    gl.uniform1f(loc(gl, prog, "u_specular"), pn(p, "specular", 0.35));
  },
};

// ---------------------------------------------------------------- ledPanel
// GPU accelerator for the CPU `ledPanel` op (ops.ts) — the two implement ONE
// spec: RGB sub-pixel LED matrix. cell = max(4,round(size*u)); integer px;
// stagger shifts odd COLUMNS by half a cell vertically before computing the
// row index, then the source sample undoes that shift to land on the
// unstaggered image (NEAREST, at the drawn cell's visual center). The 3
// vertical sub-pixel strips are disjoint axis-aligned boxes (HEADER's sdBox,
// in local px, centered coords) — only the strip lx falls in is evaluated.
// aaCov is the same 1px linear ramp as receipt/flutedGlass (local copy, since
// it lives per-frag not in HEADER).
export const ledPanel: GpuPass = {
  frag: f(`uniform float u_cell; uniform float u_gap; uniform float u_stagger; uniform float u_glow;
float aaCov(float dPx){ return clamp(0.5 - dPx, 0.0, 1.0); }
void main(){
  vec2 P = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;   // canvas px, top-left origin
  float x = floor(P.x), y = floor(P.y);
  float half_ = floor(u_cell * 0.5);
  float cx = floor(x / u_cell);
  float oddCol = mod(cx, 2.0);
  bool stag = u_stagger > 0.5 && oddCol > 0.5;
  float yEff = stag ? y + half_ : y;
  float cy = floor(yEff / u_cell);
  float lx = x - cx * u_cell;
  float ly = yEff - cy * u_cell;
  float sxc = min(u_dims.x - 1.0, cx * u_cell + half_);
  float syc = min(u_dims.y - 1.0, cy * u_cell + half_ - (stag ? half_ : 0.0));
  vec3 src = texture(u_tex, vec2((sxc+0.5)/u_dims.x, 1.0 - (syc+0.5)/u_dims.y)).rgb;
  float b = floor(u_gap * u_cell * 0.5 + 0.5);
  float inX0 = b;
  float inW = u_cell - 2.0 * b;
  float inY0 = b;
  float inY1 = u_cell - b;
  vec3 outc = vec3(0.0);
  if (inW > 0.0 && lx >= inX0 && lx < u_cell - inX0 && ly >= inY0 && ly < inY1) {
    float kf = floor((lx - inX0) * 3.0 / inW);
    float k = clamp(kf, 0.0, 2.0);
    float rx0 = inX0 + k * inW / 3.0 + 0.5;
    float rx1 = inX0 + (k + 1.0) * inW / 3.0 - 0.5;
    float cxr = (rx0 + rx1) * 0.5, hx = (rx1 - rx0) * 0.5;
    float cyr = (inY0 + inY1) * 0.5, hy = (inY1 - inY0) * 0.5;
    vec2 pp = vec2(lx + 0.5 - cxr, ly + 0.5 - cyr);
    float dPx = sdBox(pp, vec2(hx, hy));
    float mask = aaCov(dPx);
    vec3 primary = k < 0.5 ? vec3(1.0,0.0,0.0) : (k < 1.5 ? vec3(0.0,1.0,0.0) : vec3(0.0,0.0,1.0));
    float v = k < 0.5 ? src.r : (k < 1.5 ? src.g : src.b);
    outc = primary * v * mask;
  }
  outc += u_glow * 0.12 * src;
  o = vec4(clamp(outc, 0.0, 1.0), 1.0);
}`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_cell"), Math.max(4, Math.round(pn(p, "size", 14) * u)));
    gl.uniform1f(loc(gl, prog, "u_gap"), pn(p, "gap", 0.18));
    gl.uniform1f(loc(gl, prog, "u_stagger"), pb(p, "stagger", false) ? 1 : 0);
    gl.uniform1f(loc(gl, prog, "u_glow"), pn(p, "glow", 0.25));
  },
};

// ---------------------------------------------------------------- crochet
// GPU accelerator for the CPU `crochet` op (ops.ts) — the two implement ONE
// spec: yarn V-stitch lattice over a brick-offset row grid. cell =
// max(6,round(size*u)); integer px; odd rows shift x by half a cell (brick
// offset); source sample is NEAREST at the stitch's visual center (undoing
// the brick shift). The V stitch is two rotated+squashed ring SDFs (constant
// ±38° angle, cosA/sinA passed as uniforms computed once in TS f64 — never
// per-pixel trig on data); mask = union (max) of the two lobes; aaCov is the
// same 1px linear ramp as receipt/flutedGlass/ledPanel.
const DEG38 = (38 * Math.PI) / 180;
const COS38 = Math.cos(DEG38);
const SIN38 = Math.sin(DEG38);
export const crochet: GpuPass = {
  frag: f(`uniform float u_cell; uniform float u_yarnWidth; uniform vec3 u_paper; uniform float u_cosA; uniform float u_sinA;
float aaCov(float dPx){ return clamp(0.5 - dPx, 0.0, 1.0); }
void main(){
  vec2 P = vec2(v_uv.x, 1.0 - v_uv.y) * u_dims;   // canvas px, top-left origin
  float x = floor(P.x), y = floor(P.y);
  float half_ = floor(u_cell * 0.5);
  float row = floor(y / u_cell);
  float oddRow = mod(row, 2.0);
  bool stag = oddRow > 0.5;
  float ly = y - row * u_cell;
  float xEff = x + (stag ? half_ : 0.0);
  float col = floor(xEff / u_cell);
  float lx = xEff - col * u_cell;
  float px = lx - u_cell * 0.5 + 0.5;
  float py = ly - u_cell * 0.5 + 0.5;
  float sxc = clamp(col * u_cell + half_ - (stag ? half_ : 0.0), 0.0, u_dims.x - 1.0);
  float syc = clamp(row * u_cell + half_, 0.0, u_dims.y - 1.0);
  vec3 src = texture(u_tex, vec2((sxc+0.5)/u_dims.x, 1.0 - (syc+0.5)/u_dims.y)).rgb;
  vec3 yarn = clamp(src * 1.08, 0.0, 1.0);
  float ringR = u_cell * 0.30;
  float strokeHalf = u_yarnWidth * u_cell * 0.5;
  float lobeOffset = u_cell * 0.14;
  float mask = 0.0;
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? -1.0 : 1.0;
    float qx = px + s * lobeOffset;
    float qy = py;
    float prx = u_cosA * qx - s * u_sinA * qy;
    float pry = s * u_sinA * qx + u_cosA * qy;
    float pex = prx;
    float pey = pry / 0.55;
    float d = length(vec2(pex, pey)) - ringR;
    float dPx = abs(d) - strokeHalf;
    float m = aaCov(dPx);
    mask = max(mask, m);
  }
  o = vec4(mix(u_paper, yarn, mask), 1.0);
}`),
  setUniforms: (gl, prog, p, u) => {
    gl.uniform1f(loc(gl, prog, "u_cell"), Math.max(6, Math.round(pn(p, "size", 18) * u)));
    gl.uniform1f(loc(gl, prog, "u_yarnWidth"), pn(p, "yarnWidth", 0.3));
    gl.uniform3fv(loc(gl, prog, "u_paper"), col(p, "paper", "#2a2320"));
    gl.uniform1f(loc(gl, prog, "u_cosA"), COS38);
    gl.uniform1f(loc(gl, prog, "u_sinA"), SIN38);
  },
};
