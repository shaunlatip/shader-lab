// Dev-only pattern parity harness. Never reachable in production (notFound
// guard, same as /dev/thumbs). Renders every pattern type across each slider
// so a single screenshot verifies Spacing/Thickness/Opacity/Rotation/Weight
// each drive the right patterns.

import { notFound } from "next/navigation";
import PatternsClient from "./PatternsClient";

export default function PatternsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PatternsClient />;
}
