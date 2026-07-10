# Embedding a shader background

Ship a live background on any page from the **same BgConfig** the editor and the
LLM produce. Three entry points, all in `src/lib/bg-lab/embed/`.

## Web component

```html
<shader-bg config='{"version":1,"output":{"aspect":"16:9","longEdge":2000},
  "source":{"mode":"gradient","gradient":{"type":"radial","cx":0.35,"cy":0.3,
  "radius":0.95,"stops":[{"t":0,"color":"#a56cf5"},{"t":1,"color":"#7a3ad6"}]}},
  "stack":[{"id":"a","type":"lightLeak","enabled":true,
  "params":{"warmth":0.55,"intensity":0.42,"angle":315}}]}'
  style="width:100%;height:420px"></shader-bg>

<script type="module">
  import { defineShaderBg } from "/path/to/embed";
  defineShaderBg();
</script>
```

The element mounts a canvas, tracks its size (`ResizeObserver`), and runs a rAF
loop only when the config has animated effects. Change the `config` attribute to
swap looks live.

## React

```tsx
import { ShaderBg } from "@/lib/bg-lab/embed/ShaderBg";
<ShaderBg config={cfg} style={{ height: 420 }} />
```

## Imperative

```ts
import { mountShaderBg } from "@/lib/bg-lab/embed";
const bg = mountShaderBg(document.getElementById("hero"), cfg);
// bg.setConfig(next); bg.destroy();
```

## Sources

Gradient / pattern / solid render synchronously. Image / video load async
(`crossOrigin=anonymous`, so host them with permissive CORS or same-origin).

## Size

Today the embed bundles the full engine (every op). Hitting Unicorn's ~46 KB
gzip budget needs **per-config op tree-shaking** — dynamic-import the ops a
config's stack actually uses, behind a rollup entry, plus a CI size check. That
refactor is the remaining T11 work; the runtime + web component + React wrapper
here are the functional core.
