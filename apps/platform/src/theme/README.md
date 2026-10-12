# Theme rules (condensed from compsys `.ulpi/design`)

Dark only. Import `@/theme/index.css` once (main.tsx). Vanilla CSS and CSS Modules; no Tailwind.
Always use tokens (`var(--color-*)`, `--spacing-*`, `--font-*`, `--motion-*`); no raw hex/rgb/hsl. Colours are `oklch()`.

## Identity
Aubergine-black ink, one apricot accent (`--color-brand-primary`) for focus, active nav and primary action. 60% background,
30% surfaces, at most 10% accent and semantic colours. Calm, technical, sentence case. No gradients, glow, glassmorphism,
nested cards, accent rails/dots, stickers, blobs, forced uppercase, eyebrow labels, hover lift/bounce/rotation.

## Type
- Display `--font-display` (Georgia; the Brilon face is not shipped because its licence is unconfirmed): the wordmark (`.wordmark`) and the page `h1` only.
- Body/UI `--font-body`/`--font-ui` (Trebuchet MS): everything else. Measure max 70ch.
- Code `--font-code`: code and machine values only, never headings or labels.

## Scales
- Spacing `--spacing-1..16` (4px steps). Radius sm 4, md 6, lg 10; `full` only for true circles/tracks.
- Motion 100/180/300 ms (`--motion-duration-*`), ease `cubic-bezier(0.16,1,0.3,1)`. Animate transform/opacity only.
  Under `prefers-reduced-motion` drop transforms and non-essential transitions.
- Shadows only on overlapping surfaces (menus, popovers, modals, toasts). Cards/panels use contrast and space.

## Utilities (utilities.css)
- `.u-brackets`: four L-corners 4px outside on hover/focus; `.u-brackets--on` keeps them. For actionable surfaces and
  buttons, once per target (never nested). Not for static cards, disabled items, plain links, or whole nav rows.
- `.u-segments`: tabs/selects. Tapered 2px lines above and below the active or hovered segment. No boxes or brackets.
- `.u-marker`: flat apricot highlight behind links. Never replaces a focus ring or selection mark; no underline on active nav.
- Inputs/textareas: border goes 2px on hover/focus, accent on focus; no external brackets.
- Focus is always a full 2px outline (`--focus-ring`). Keep it visible.

## Verdicts
`data-verdict` on `.u-verdict`: pass -> success, fail -> danger, unknown / not-run / stale -> `--color-text-subtle`
(stale has a dashed border). Always pair colour with a glyph and the word. Only `pass` may use the success colour.

## React Flow (reactflow.css)
Nodes use `--color-surface-secondary`, `--color-border-subtle`, radius md, no shadow, no pills. Selected node gets the
2px focus outline. Edge style (solid/dashed/dotted) carries certainty; colour does not.

## Voice
Plain and precise: "Start work", "Copy packet". Literal "unknown" when a value is unknown. No sales copy.
