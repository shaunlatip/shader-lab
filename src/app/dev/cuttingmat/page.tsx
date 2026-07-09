// Dev-only cutting-mat parity harness (prod-guarded like /dev/thumbs). Overlays
// the lab cuttingMat render on the reference screenshots at 5 spacing values.

import { notFound } from "next/navigation";
import CuttingMatClient from "./CuttingMatClient";

export default function CuttingMatPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CuttingMatClient />;
}
