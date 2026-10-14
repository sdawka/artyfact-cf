# Theme rules (condensed from compsys `.ulpi/design`)

Dark only. Import `@/theme/index.css` once (main.tsx). Vanilla CSS and CSS Modules; no Tailwind.
Always use tokens (`var(--color-*)`, `--spacing-*`, `--font-*`, `--motion-*`); no raw hex/rgb/hsl. Colours are `oklch()`.

## Identity
Aubergine-black ink, one apricot accent (`--color-brand-primary`). **Apricot is the operator's colour**: it marks where you
are (active nav, the current row's rule), what you can do (the one primary action) and what waits on you
(`--color-attention`: waiting counts, "await your review"). Everything else is quiet; code says the role
(`--color-attention`, `--color-link`), not "brand". 60% background, 30% surfaces, at most 10% accent and semantic colours.
Calm, technical, sentence case. No glass cards, nested cards, accent rails/dots, stickers, blobs, forced uppercase,
eyebrow labels, hover lift/bounce/rotation.

- **One primary per view.** `Button variant="primary"` once per view (in the PageHeader, or in an open Panel, whose
  primary then replaces the header's: the header's turns secondary). A disabled primary uses
  `--color-primary-disabled-bg` with `--color-primary-disabled-text` and shows its reason (`Button reason=…`).
- **Links** in text are `--color-link` (text colour) with a 1px `--color-link-underline` offset 0.2em; hover darkens the
  underline to apricot. Never apricot text at rest. Ids, shas and paths that link use the code face, underline on hover.
- **Markers** (`.u-marker`) only for the one next-step link in an empty state or a ledger row, at most two per region.
  Never on ids, logs, breadcrumbs, list items or every link in a row.
- **Selection** is one rule everywhere: a 2px apricot left rule plus one surface step (`.u-selected`, or `.u-selectable`
  on an element carrying `aria-current` / `aria-selected` / `aria-pressed`; tokens `--selection-*`). Hover is the surface
  step only; focus is the 2px outline. Toggle buttons (`aria-pressed`) are styled once in `ui.module.css`.
- **Focus** rings show on keyboard focus only (`:focus-visible`), including headings focused by script (`tabIndex=-1`).

Glow, gradients and haze are allowed, through the effect tokens (`effects.css`: `--glow-*`, `--shadow-glow-*`,
`--gradient-haze*`, `--motion-duration-ambient`) and `@artyfact/effects` (`SurfaceField`, `AmbientField`):
- Signature moments: the System's content surface, hero areas, promotion and commit events. Light belongs to meaningful card and status boundaries, never a detached sphere.
- State emphasis: glow in a state colour on the element whose state changed or needs attention (a failing gate, a fresh pass).
  Same rule as verdicts: only `pass` may glow in the success colour.
- **Glow only for selection and status**, through `--shadow-glow-selection` and `--shadow-glow-status-{attention,fail,pass}`,
  always alongside the outline or rule that carries the meaning, never instead of it. Nothing glows at rest otherwise: no
  resting or hover glow on nav, cards, tiles, menus or buttons.
- Ambient haze sits behind content, never behind dense text, and stays dim (`AmbientField` intensity at or under 0.5 behind copy).
- The Shell owns one fixed `AmbientField` (colour and intensity from `useSystemVitals()`, capped at 0.45) behind every view.
  Shell chrome sits on veils so it shows through: `--surface-veil` with `--backdrop-veil` for the top bar and nav,
  `--surface-veil-strong` for the Inspector, `--surface-wash` behind the main column. Cards and panels stay opaque.
- Graphs: selection gets `--shadow-glow-selection` with its outline, status a faint `--shadow-glow-status-fail` /
  `--shadow-glow-status-pass`; edges touching the selection carry `.fx-flow`. CSS only.
- Moments: dispatch `artyfact:fx` on `window` (`{ kind: promoted | submitted | commit | fail | select, x?, y?, strength? }`,
  viewport coordinates) and the Shell's field ripples there, tinted by kind. The TopBar Effects switch (localStorage
  `artyfact.effects`, default off under reduced motion) turns decorative motion off, including card light, WebGL and `.fx-flow`, while keeping static fallbacks.
- Text contrast and focus rings win: no glow, gradient or canvas may lower text below AA or hide the 2px focus outline.
- Effects are decorative (`aria-hidden`), honour reduced motion, and the app must read the same with them off.

## Type
Self-hosted (SIL OFL 1.1, `fonts.css` imported first, files in `public/fonts/*-vN.woff2`, the same bytes in both apps,
UI face preloaded, metric-matched `"Atkinson Fallback"` / `"Alegreya Fallback"` faces so the swap barely reflows):
- Display `--font-display` (Alegreya): the wordmark (`.wordmark`) and the page `h1` only. One display-face element per view.
- UI and body `--font-ui` / `--font-body` (Atkinson Hyperlegible Next): everything else; `l/1/I` and `0/O` stay distinct.
- Code `--font-code` (Atkinson Hyperlegible Mono): ids, shas, commands and paths you could paste. Never labels or prose.
- `--font-glyph`: system symbol faces for the `aria-hidden` status glyph span (`.u-glyph`), for glyphs the faces lack.

Role tokens are `font` shorthands; components name a role, never a size (`font: var(--type-h2)`):
`--type-display` / `--type-display-2` (site hero / section; pair with `--type-display-tracking` / `-2-tracking`),
`--type-system` (Overview h1, the System name), `--type-h1` (every other h1, 1.75rem below 640px; `--type-h1-compact` on
canvases; `--type-h1-tracking`), `--type-h2` / `--type-h3` (UI face, sections / panels), `--type-body`, `--type-prose`
(reading, `--measure-prose` 68ch), `--type-ui` (rows, chips, labels), `--type-control` (buttons, selects), `--type-meta`
(meta lines, with `--color-text-secondary`), `--type-hint` (Kbd and legend keys only; nothing else under 13px),
`--type-code` (inline, em-relative) / `--type-code-block`, `--type-numeric` (counts; `.u-numeric` adds tabular figures).
Headings are sentence case, no tracking-out. Body measure `--measure-body` 70ch.

## Surfaces
Wells go down, overlays go up, one step per containment, at most two steps on a page: `--surface-well` (code, commands,
inset derivations) < `--surface-page` < `--surface-panel` (cards, panels, queue, detail pane) < `--surface-raised`
(current or hovered row, inputs on a panel) < `--surface-overlay` (menus, popovers, dialogs, sheets, with `--shadow-md`).
Rows are divided by `--color-border-faint`; a border separates only what a person must tell apart (rows, panes, overlays).

## Scales
- Spacing `--spacing-1..16` (4px steps). Radius sm 4, md 6, lg 10; `full` only for true circles/tracks.
- Motion 100/180/300 ms (`--motion-duration-*`), ease `cubic-bezier(0.16,1,0.3,1)`. Animate transform/opacity only.
  Under `prefers-reduced-motion` drop transforms and non-essential transitions.
- Shadows only on overlapping surfaces (menus, popovers, modals, toasts). Cards/panels use contrast and space.

## Utilities (utilities.css)
- `.u-brackets`: four L-corners 4px outside on hover/focus; `.u-brackets--on` keeps them. For actionable surfaces and
  buttons, once per target (never nested). Not for static cards, disabled items, plain links, or whole nav rows.
- `.u-segments`: tabs/selects. Tapered 2px lines above and below the active or hovered segment. No boxes or brackets.
- `.u-marker`: flat apricot highlight for the one next-step link per region (see Identity). Never replaces a focus ring or selection mark.
- `.u-selected` / `.u-selectable`: the selection rule. `.u-numeric`: tabular counts. `.u-glyph`: status glyph span.
- Inputs/textareas: border goes 2px on hover/focus, accent on focus; no external brackets.
- Focus is always a full 2px outline (`--focus-ring`). Keep it visible.

## Kind colours (kinds.css)
`--kind-<token>` for the twelve view-hint colours (`neutral` … `teal`), dark on `:root`, light under
`:root[data-theme="light"]`. Glyphs only (`kindColour(view)` sets `--kind`), always beside a label or name. Kind hues
never reuse the verdict hues (success, danger), and verdict rows hide the kind glyph (`NodeChip glyph={false}` or
`<KindGlyphs hidden>`), so a ✓ beside a verdict always means pass.

## Verdicts
`data-verdict` on `.u-verdict`: pass -> success, fail -> danger, unknown / not-run / stale -> `--color-text-subtle`
(stale has a dashed border). Always pair colour with a glyph and the word. Only `pass` may use the success colour.

## React Flow (reactflow.css)
Nodes use `--color-surface-secondary`, `--color-border-subtle`, radius md, no shadow, no pills. Selected node gets the
2px focus outline. Edge style (solid/dashed/dotted) carries certainty; colour does not.

## Voice
Plain and precise: "Start work", "Copy packet". Literal "unknown" when a value is unknown. No sales copy.
