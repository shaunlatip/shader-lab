import { createContext, useContext, type ReactNode } from "react";
import { useImageSource, type ResolvedSource } from "@/hooks/useImageSource";
import { useBgLab } from "./BgLabProvider";

const SourceContext = createContext<ResolvedSource | null>(null);

export function SourceProvider({ children }: { children: ReactNode }) {
  const { config } = useBgLab();
  const resolved = useImageSource(config.source);
  return <SourceContext.Provider value={resolved}>{children}</SourceContext.Provider>;
}

export function useEngineSource(): ResolvedSource {
  const ctx = useContext(SourceContext);
  if (!ctx) throw new Error("useEngineSource must be used within SourceProvider");
  return ctx;
}
