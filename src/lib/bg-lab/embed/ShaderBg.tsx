"use client";

// Thin React wrapper over the zero-React embed runtime. Same config, same
// render as the editor.
//   <ShaderBg config={cfg} style={{ height: 400 }} />

import { useEffect, useRef, type CSSProperties } from "react";
import { mountShaderBg, type ShaderBgHandle } from "./runtime";
import type { BgConfig } from "../types";

export function ShaderBg({
  config,
  className,
  style,
}: {
  config: BgConfig | string;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const handle = useRef<ShaderBgHandle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    handle.current = mountShaderBg(ref.current, config);
    return () => {
      handle.current?.destroy();
      handle.current = null;
    };
    // mount once; config changes handled in the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    handle.current?.setConfig(config);
  }, [config]);

  return <div ref={ref} className={className} style={{ position: "relative", ...style }} />;
}
