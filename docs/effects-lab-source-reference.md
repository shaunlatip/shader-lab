# Effects Lab — source technique reference (research appendix)

Condensed, faithful extraction of the techniques the [shader roadmap](./effects-lab-shader-roadmap.md)
is built from, captured from the sources so the plan can be verified without re-fetching the articles.
Each item: what it is, the key formula/values, and whether it applies to a flat 2D photo (our case).

**Product context.** "Shader Lab" (formerly "Effects Lab"; the home page `/` of this repo, code in `src/lib/bg-lab/`) is a browser image/video
effects studio: a freeform **stack** of effects over an image/video/solid **source**, hybrid CPU-2D-canvas +
WebGL2-fragment-shader engine. Goal of the roadmap: reach/exceed ascii-magic's fidelity (esp. **halftone**),
add high-value new effects, and add a **geometric pattern generator** as a new synthesizable source.

---

## A. Halftone (Maxime Heckel — Shades of Halftone)
1. **Grid** via `fract`: `vec2 cellUv = fract(vUv * gridSize); float dist = length(cellUv - 0.5);`
2. **Pixelation align** (filter mode): `uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize)` so all pixels in a cell read one color.
3. **Staggered grid**: alternate rows offset by half a cell to reduce white space.
4. **Luma→radius**: `luma = dot(vec3(.2126,.7152,.0722), rgb); radius = uRadius*(0.1+luma);`
5. **smoothstep AA**: `circle = smoothstep(radius-0.01, radius+0.01, dist);`
6. **fwidth AA** (resolution-independent): `float e = fwidth(dist); circle = smoothstep(radius-e, radius+e, dist);`
7. **Area-proportional CMYK dot**: `r = maxRadius * sqrt(coverage)`.
8. **RGB→CMYK** (Matt DesLauriers): `k=min(1-r,min(1-g,1-b)); cmy=(1-rgb-k)/(1-k);`
9. **CMYK screen angles**: Cyan 15°, Magenta 75°, Yellow 0°, Key 45° (minimize moiré).
10. **Per-channel rotation** before domain repetition; **subtractive blend** `out = white*(1-C)*(1-M)*(1-Y)`.
11. **Moiré control** = per-layer rotation. **Cell-center sampling** for round dots.
12. **Break-the-grid overflow**: 3×3+ neighbor kernel lets dots overflow without clipping.
13. **Ring** = `A AND NOT B` (two circles). **Gooey** = neighbor circles blended via `smoothmin()`.
14. **Displaced/animated dots**: a mouse/velocity trail texture displaces cell centers (frame-buffer ping-pong).
Notes: post does NOT address gamma/linear-light. All photo-applicable.

## B. Dithering (Maxime Heckel — Art of Dithering)
- Ordered **Bayer** matrices; threshold compared to luma, then **quantize** `floor(c*(n-1)+0.5)/(n-1)`.
- **Blue noise** texture beats white/IGN (low-frequency-poor → less clumping). Sample tiled by `gl_FragCoord/size`.
- Per-channel vs luma; limited palettes.
- **Stylized 8×8 matrices** (stripes / cross-stripe) as artistic dither (from the Creative-Medium post, C4).
- Error diffusion (Floyd–Steinberg) is sequential → CPU only.
- Pixelation step precedes dithering for retro look.

## C. Painterly / Kuwahara (Maxime Heckel — Painterly Shaders; Kyprianidis 2010)
- **4-sector**: box → 4 quadrants; per-sector mean+variance (`σ² = E[x²]-E[x]²`, variance via luma `dot(v,vec3(.299,.587,.114))`); output mean of lowest-variance sector. Edge-preserving.
- **Papari 8-sector circular** kernel; **Gaussian weight** `exp(-d²/(2σ²))`, `σ≈radius/3`; **polynomial weight** (faster) `max(0,(x+η)-λy²)²`, `η≈0.1, λ≈0.5`.
- **Anisotropic (Kyprianidis)**: structure tensor from Sobel `E=Σgx², G=Σgy², F=Σgx·gy`; **SMOOTH the tensor (Gaussian)**; eigenvalues `λ1,2=((E+G)±√((E-G)²+4F²))/2`; gradient angle `θ=0.5·atan2(2F,E-G)`, filter major axis along **tangent** `θ+π/2`; anisotropy `A=(λ1-λ2)/(λ1+λ2)`; ellipse axes scaled `(α+A)/α` and `α/(α+A)`. Multi-pass (tensor → smooth → filter [→ tone]).
- Kernel size 4–12; degrades >12. All photo-applicable; anisotropic is multi-pass.

## D. Edge / line-art (Maxime Heckel — Moebius). 3D-heavy; photo subset only:
- **Sobel** kernels `Sx=[[-1,0,1],[-2,0,2],[-1,0,1]]`, `Sy=[[-1,-2,-1],[0,0,0],[1,2,1]]`; magnitude `√(gx²+gy²)`. **On a photo: run on luma** (the depth/normal versions are 3D-only and excluded).
- **Hand-drawn wiggle**: `displacement = vec2(hash*sin(y*freq), hash*cos(x*freq))*amp/res`, freq≈0.08.
- **Crosshatch luma bands**: `(luma<=.45 && mod(uv.y*res.y,8.)<=1.) || (luma<=.55 && mod(uv.x*res.x,8.)<=1.) || (luma<=.65 && mod(uv.x*res.y+uv.y*res.x,8.)<=1.)` → ink.
- **Raster dots**: grid of circles sized by darkness.
- DoG/XDoG not in the post (standard addition for cleaner ink lines; needs two blurs).
- Excluded (3D-only): depth Sobel, normal Sobel, stylized specular lighting, depth linearization.

## E. Dispersion / chromatic (Maxime Heckel — Refraction). 2D-portable subset:
- **Per-channel offset**: `R=tex(uv+offR).r; G=tex(uv+offG).g; B=tex(uv+offB).b;` (for a photo: offset = radial `(uv-0.5)` or uniform, not `refract()`).
- **Multi-sample loop**: `for i in LOOP { slide=i/LOOP*0.1; color.r+=tex(uv+offR*(power+slide*1.)*aberration).r; ...g *2 ...b *3 } color/=LOOP;` → smooth prism.
- **sat()**: `mix(vec3(dot(rgb,vec3(.2125,.7154,.0721))), rgb, intensity)`.
- **rygcbv** 6-wavelength expansion (forward/reverse formulas) for finer dispersion (6 IORs).
- Excluded (3D-only): `refract()`+worldNormal+eyeVector, Blinn-Phong specular/diffuse, Fresnel, backside FBO.

## F. Creative-medium pixel effects (Maxime Heckel — Post-Processing as a Creative Medium). All 2D photo, per-fragment unless noted:
- **C0 pixelate** (foundation): `uvPixel = normalizedPixelSize*floor(uv/normalizedPixelSize)`.
- **C1 receipt/bars**: luma→bar width (steps .3/.5/.7/.9/.99 → 1.0/.7/.5/.3/.1/0), bar span y 0.05–0.95.
- **C2 ASCII atlas**: `charIndex=floor(luma*(charCount-1)); asciiUV=((charIndex+cellUV.x)/charCount, cellUV.y); ch=tex(asciiTexture,asciiUV).r;` — needs a glyph atlas texture (2nd sampler).
- **C3 SDF cells**: `circleSDF=length(p-0.5)`; threshold + luma flip fg/bg (circle/cross/triangle).
- **C4 dither matrices**: 8×8 stripe/cross-stripe arrays compared to luma (see B).
- **C5 LED panel**: column stagger `mod(floor(coord.x),2.)*0.5`, 3 RGB sub-pixels `coord*vec2(3,1)`, border mask `1-subCellUV²*(MASK_BORDER-luma*.25)`, `smoothstep(0,.95,mask)`.
- **C6 crochet**: rotated ellipse per cell (±65°, aspect 1.55), sinusoidal row offset, noise/hue.
- **C7 lego**: per-cell stud lit in 2D `lighting=dot(normalize(cellUV-.5),lightPos)*.7; dis=abs(distance(cellUV,.5)*2-.5); color*=smoothstep(.1,0,dis)*lighting+1;`
- **C8 fluted/frosted glass**: `flutePos=fract(uv.x*fluteCount+.5); distortion=cos(flutePos*2π)*π*.15;` fake normal from distortion derivative → diffuse/specular; frosted adds blur+noise+dispersion. fluteCount≈25.
- **C9 progressive depixelation**: time/`progress`-driven pixel-size reduction across LEVELS=5 (base 32).
- **C10 mouse-trail**: FBO ping-pong accumulates a decaying trail; needs persistent state (stateful, defer).

## G. Pattern / generator math (Book of Shaders; iquilezles)
- **Cell setup**: `vec2 g=uv*scale; vec2 id=floor(g); vec2 c=fract(g)-0.5;`
- **Brick/offset**: `g.x += step(1.,mod(g.y,2.))*0.5;`
- **AA**: `1.0 - smoothstep(-w,w,d)` with `w=fwidth(d)`.
- **2D SDFs** (iq): `sdCircle(p,r)=length(p)-r`; `sdBox`, `sdRoundedBox`, `sdSegment`, `sdRhombus`, `sdHexagon`, `sdEquilateralTriangle`, `sdStar`, `sdArc`, `sdPie`, `sdMoon`.
- **Analytic checker AA** (iq filterableprocedurals): `filteredCheckers` via `2*(abs(fract((p-.5w)*.5)-.5)-abs(fract((p+.5w)*.5)-.5))/w`, `w=max(|dpdx|,|dpdy|)`.
- **Voronoi/Worley** (iq): 3×3 nearest-feature loop; 2nd pass for border distance.
- **Cosine palette** (iq): `a + b*cos(2π*(c*t + d))`.
- **Hashing**: integer-style hash over **bounded cell ids** (sin-hash loses precision at huge coords). e.g. `Math.imul`-based 32-bit mix on `(ix,iy)`.
- Patterns to build: dot grid, line grid, checker, stripes, concentric rings, iso/triangular lattice (shear), hex, truchet (per-cell rotated arcs), voronoi, moiré (`abs(fieldA-fieldB)`), fbm field.

## H. Cross-cutting quality (LearnOpenGL; RasterGrid; Wronski; standard)
- **Linear light**: `toLinear`/`toSRGB` around any averaging op (sRGB piecewise or `pow(x,2.2)`); standard, omitted by Heckel halftone.
- **Separable Gaussian** (RasterGrid, linear-sampled 5≡9): weights `0.2270,0.3162,0.0703`, offsets `0.0,1.3846,3.2308` texels, H then V.
- **Dual-filter bloom** (LearnOpenGL/Jimenez): 13-tap downsample (`e*.125 + (a+c+g+i)*.03125 + (b+d+f+h)*.0625 + (j+k+l+m)*.125`), 9-tap tent upsample (`(e*4+(b+d+f+h)*2+(a+c+g+i))/16`), Karis average on first down. Needs a mip pyramid (multiple RT sizes).
- **Blue-noise + golden-ratio temporal**: `fract(n + frame*0.61803)` (animation only).
- **Film grain**: amplitude ∝ `1-abs(2·luma-1)` (luminance-dependent); mono for film; size ~ ISO.
- **Analytic AA**: `fwidth`+`smoothstep` for any thresholded shape.
