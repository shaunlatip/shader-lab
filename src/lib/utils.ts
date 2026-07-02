import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Custom tailwind-merge instance that recognizes our design-system font-size
 * utilities (text-h1…h6, text-hero, text-cap-tag, text-caption).
 *
 * Without this, twMerge treats e.g. "text-cap-tag" as a text-color class and
 * drops it when merged with "text-shade-6". This config tells twMerge they
 * belong to the font-size group, not text-color.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-hero",
        "text-h1",
        "text-h2",
        "text-h3",
        "text-h4",
        "text-h5",
        "text-h6",
        "text-cap-tag",
        "text-caption",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
