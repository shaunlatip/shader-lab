# Alpha video from a PNG sequence

Export a **PNG sequence (.zip)** from the tool (Export → format → *PNG sequence*),
unzip it, then run one of these. PNG frames carry a real alpha channel, so the
resulting video composites cleanly over any page background — the same trick the
Shopify Editions transparent UI recordings use.

The tool's own frames are opaque backgrounds; for transparent UI *elements* you'd
render those with a transparent stack (`background: transparent` on a glyph
effect) — the alpha pipeline below is identical either way.

Assume frames are `frame_000.png … frame_NNN.png` at some `FPS`.

## VP9 alpha (`.webm`) — best for web `<video>`

```
ffmpeg -framerate 24 -i frame_%03d.png \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 22 \
  -auto-alt-ref 0 out-alpha.webm
```

`yuva420p` + `-auto-alt-ref 0` are the two flags people miss — without them the
alpha channel is dropped.

## HEVC alpha (`.mov`) — best for Safari / Apple

```
ffmpeg -framerate 24 -i frame_%03d.png \
  -c:v hevc_videotoolbox -alpha_quality 0.9 -tag:v hvc1 \
  -pix_fmt yuva420p out-alpha.mov
```

## H.264 fallback (no alpha) — matte on a solid color

```
ffmpeg -framerate 24 -i frame_%03d.png \
  -c:v libx264 -pix_fmt yuv420p -crf 18 out.mp4
```

## Ship both, pick per browser

```html
<video autoplay loop muted playsinline>
  <source src="out-alpha.webm" type="video/webm">   <!-- Chrome/Firefox -->
  <source src="out-alpha.mov"  type="video/quicktime"> <!-- Safari -->
</video>
```

## Notes

- In-browser alpha *encode* (WebCodecs VP9-alpha) is still gappy in 2026, which is
  why the PNG-sequence + ffmpeg route is the reliable path the tool ships.
- Keep the loop seamless: animated effects (grain) advance by frame count and wrap,
  so the first and last frame meet.
