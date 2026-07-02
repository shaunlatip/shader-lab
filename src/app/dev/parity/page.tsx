// Dev-only GL/CPU parity + benchmark harness. Never reachable in production —
// see the notFound() guard below. Heavy client logic lives in ParityClient,
// loaded with ssr:false since it touches canvas/WebGL directly.

import { notFound } from "next/navigation";
import ParityClient from "./ParityClient";

export default function ParityPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ParityClient />;
}
