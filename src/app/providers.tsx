"use client";

import dynamic from "next/dynamic";
import { ThemeProvider } from "next-themes";

// Client-only (needs DOM) — load without SSR so importing it never runs on the
// server. Typed to its one prop we use; the package's own prop union confuses
// dynamic()'s inference, so we pin it here.
const Agentation = dynamic<{ endpoint?: string }>(
  () => import("agentation").then((m) => m.Agentation as never),
  { ssr: false },
);

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
      {children}
      {/* Agentation — UI annotation toolbar → structured context for coding
        * agents. Dev-only; points at the local agentation-mcp server (port
        * 4747) so annotations sync to the agent via MCP. */}
      {process.env.NODE_ENV === "development" && (
        <Agentation endpoint="http://localhost:4747" />
      )}
    </ThemeProvider>
  );
}
