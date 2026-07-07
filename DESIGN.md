# Design

Visual system for Shader Lab. Register: product (see PRODUCT.md). The chrome is a neutral instrument around the artwork; every vibrant pixel on screen should come from the shader output.

## Theme

Time-aware: dark from 18:00 to 05:00 local, light otherwise, seeded pre-paint via a head script. A manual toggle (in the canvas header) overrides and persists (`theme-manual` flag). Both themes are first-class; neither is decoration.

## Color

Strategy: Restrained. True-gray neutrals only; no cream, beige, or warm paper tints in the chrome.

- Shade scale: the existing 11-step true-gray OKLCH scale (`--color-shade-1` … `--color-shade-11`).
- Light canvas: off-white (shade-derived, not `#fff`). Dark canvas: off-black (not `#000`).
- Semantic roles per `[data-theme]`: `canvas`, `surface` (panels), `text-primary`, `text-secondary`, `border-default`, `border-strong`.
- Accent: none in the chrome. Selection and primary action read through weight, fill inversion (text-primary on canvas ↔ canvas on text-primary), and border strength.
- Effect default colors (ink/paper inside effects) are content, not chrome; they follow the physical-media ideal of each effect (see Effect defaults table).

## Typography

- UI/body: **General Sans** (Fontshare, self-hosted variable), `--font-lab`. 12–13px controls, 13–14px body. Fixed px, no fluid scaling.
- Display: **Cabinet Grotesk** (Fontshare, self-hosted variable), `--font-nagel` slot: wordmark, effect titles, section headers.
- Values/code: **Geist Mono** (`--font-mono`): hex fields, numeric readouts, export dimensions.
- Engine glyph rendering keeps `ui-monospace` — never couple UI fonts to render output.
- Scale ratio ~1.2; hierarchy through weight (500/600) over size where space is tight.

## Radius register

Three steps, no ad-hoc values:

- `--radius-control: 8px` — buttons, inputs, selects, sliders, swatches, cards' inner controls.
- `--radius-card: 10px` — effect cards, panels' inner cards, preset tiles, popovers.
- `--radius-chip: 9999px` — chips, pills, toggle thumbs.
- `--radius-frame: 12px` — the stage canvas frame only.

## Controls

- Borders: `border-border-default` at rest, `border-border-strong` on hover. Never near-black outlines on light surfaces.
- Every interactive element has default / hover / focus-visible / active / disabled. Hover = border-strong + subtle bg shift (`shade-9` light, `shade-3` dark). Active = `scale-[0.98]`. Focus = ring.
- Selects and popovers carry `lab-chrome font-lab` so Radix portals inherit tokens.
- Secondary affordances (drag grips, remove buttons) are hover/focus-revealed, not permanently visible.

## Motion

- 150–250ms, ease-out. Motion conveys state only: expand/collapse, reveal, drag feedback.
- Collapsibles animate `grid-template-rows` (0fr/1fr); bottom-pinned drawers grow upward from their anchor.
- Theme switch uses View Transitions cross-fade. Respect `prefers-reduced-motion`.

## Layout

- Two panels: left = input/output lifecycle (Source, Drafts, Export drawer), right = the creative loop (add effect, stack, presets, AI). Canvas center on a quiet solid stage (no decorative checkerboard; checker only signals true transparency behind the artwork).
- Panels resizable (left 280–480px, right 300–560px), collapsible to a 44px rail, both persisted.
- Section rhythm inside panels: 16px section gaps, 8px intra-group, one CollapsibleSection vocabulary everywhere.

## Voice

Labels are nouns ("Starters", "Your sets"), actions are verbs ("Save", "Export"). Helper copy is one short clause; anything longer becomes a tooltip. No exclamation marks.

## Effect defaults doctrine

Each effect's out-of-box parameters must reproduce the physical ideal it descends from (Leuchtturm dot grid, CMYK newsprint at screen angles 15/75/0/45, engraving hatching, risograph inks). Light paper, dark ink by default; dark modes are a choice, not a default. The per-effect audit table lives at the end of this file (added in the defaults-audit phase).
