"use client";

import dynamic from "next/dynamic";

// The editor touches window/canvas/localStorage — never render it on the server.
const BgLab = dynamic(() => import("@/components/bg-lab/BgLab"), { ssr: false });

export default function ShaderLab() {
  return <BgLab />;
}
