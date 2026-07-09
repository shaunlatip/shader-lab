"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "bg-lab/swatches/v1";
const MAX = 12;

/**
 * User-saved color swatches, shared by every color picker in the lab.
 * Stored as 6-digit hex strings; newest first, capped at MAX.
 */
export function useSwatches() {
  const [swatches, setSwatches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(KEY);
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      return Array.isArray(parsed) ? parsed.filter((s) => /^#[0-9a-f]{6}$/i.test(s)) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(swatches));
    } catch {
      // storage unavailable — swatches stay in-memory
    }
  }, [swatches]);

  const addSwatch = useCallback((hex: string) => {
    const norm = hex.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(norm)) return;
    setSwatches((s) => [norm, ...s.filter((x) => x !== norm)].slice(0, MAX));
  }, []);

  return { swatches, addSwatch };
}
