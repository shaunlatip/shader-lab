// BG Lab embed — public surface for shipping a live shader background from a
// BgConfig on any site (same config the editor + LLM produce).
//
//   import { defineShaderBg } from "@/lib/bg-lab/embed";  // web component
//   import { ShaderBg } from "@/lib/bg-lab/embed/ShaderBg"; // React
//   import { mountShaderBg } from "@/lib/bg-lab/embed";     // imperative
//
// Note: this bundles the full engine (all ops). Per-config op tree-shaking to
// hit the ≤46 KB budget is a follow-up — it needs dynamic op loading + a rollup
// entry; see docs/embed.md.

export { mountShaderBg, type ShaderBgHandle } from "./runtime";
export { ShaderBgElement, defineShaderBg } from "./element";
export { validateConfig } from "../schema";
export type { BgConfig } from "../types";
