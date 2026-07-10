// <shader-bg config="{…}"> — a custom element that mounts a live shader
// background from a BgConfig JSON string. Drop it on any page:
//   <shader-bg config='{"version":1,...}' style="width:100%;height:400px"></shader-bg>
//   <script type="module">import { defineShaderBg } from ".../embed"; defineShaderBg()</script>

import { mountShaderBg, type ShaderBgHandle } from "./runtime";

export class ShaderBgElement extends HTMLElement {
  private handle: ShaderBgHandle | null = null;

  static get observedAttributes() {
    return ["config"];
  }

  connectedCallback() {
    if (!this.style.display) this.style.display = "block";
    if (!this.style.position) this.style.position = "relative";
    const cfg = this.getAttribute("config");
    if (!cfg) return;
    try {
      this.handle = mountShaderBg(this, cfg);
    } catch (e) {
      console.error("[shader-bg] invalid config", e);
    }
  }

  disconnectedCallback() {
    this.handle?.destroy();
    this.handle = null;
  }

  attributeChangedCallback(name: string, _old: string | null, val: string | null) {
    if (name === "config" && this.handle && val) {
      try {
        this.handle.setConfig(val);
      } catch (e) {
        console.error("[shader-bg] invalid config", e);
      }
    }
  }
}

/** Register the element (idempotent). Call once at startup. */
export function defineShaderBg(tag = "shader-bg") {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, ShaderBgElement);
  }
}
