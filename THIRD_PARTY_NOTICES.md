# Third-party notices

artyfact is licensed under Apache-2.0. This file records components that are not covered by that licence or need a note. It is not a full dependency inventory; npm dependencies keep their own licences in `node_modules`.

## elkjs

Used by the Map and Journeys views for graph layout (`apps/platform`, dependency `elkjs`). elkjs is offered under `EPL-2.0 OR GPL-3.0-or-later`. This project uses it under EPL-2.0. EPL-2.0 is a file-level copyleft licence and allows use from Apache-2.0 code as long as elkjs is not modified. artyfact does not modify it. The built SPA bundles the unmodified library, so the source stays available from the upstream project (https://github.com/kieler/elkjs) and the EPL-2.0 text is in `licenses/elkjs-LICENSE.md`. If a copy of elkjs is ever patched here, those patched files must be published under EPL-2.0.

## Ontology engine

`packages/ontology` is a copy of bropilot's `packages/ontology-engine` at commit `cb1599c`, released under MIT by the Bropilot contributors. The copy and artyfact's changes to it stay under MIT; the licence text is `packages/ontology/LICENSE`, which every copy of those files must keep.

## Orb effect

The `Orb` in `packages/effects/src/orb/` is a clean-room implementation written from a behavioural spec without reference to any third-party source, and is original Apache-2.0 code like the rest of `packages/effects`.

## ogl

WebGL helper used by `packages/effects` (dependency `ogl`). Released under the Unlicense (public domain dedication); no conditions apply. Upstream: https://github.com/oframe/ogl.

## Fonts: Alegreya, Atkinson Hyperlegible Next and Mono

Self-hosted in `apps/platform/public/fonts/` and `apps/site/public/fonts/` (the same files in both apps) and served with the
pages. All three families are licensed under the SIL Open Font License 1.1 and declare no Reserved Font Names; the files
are subsets of the upstream variable fonts (Latin, Latin-1 Supplement, General Punctuation and Arrows; Alegreya limited to
weights 400 to 700 and the Mono face to 400 to 600), made with fontTools and keeping the original name tables.

- Alegreya, Copyright 2011 The Alegreya Project Authors (https://github.com/huertatipografica/Alegreya). Licence: `licenses/OFL-Alegreya.txt`.
- Atkinson Hyperlegible Next, Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors
  (https://github.com/googlefonts/atkinson-hyperlegible-next), and Atkinson Hyperlegible Mono, Copyright 2020-2024 The Atkinson
  Hyperlegible Mono Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next-mono). Licence: `licenses/OFL-Atkinson-Hyperlegible.txt`.

Sources: the `ofl/alegreya`, `ofl/atkinsonhyperlegiblenext` and `ofl/atkinsonhyperlegiblemono` directories of
https://github.com/google/fonts. The fonts stay under the OFL; they are not covered by the project's Apache-2.0 licence.

## Brilon (display font)

Not shipped. An earlier version of the theme loaded a Brilon woff2 file, but its licence was never confirmed, so the file
and its `@font-face` rule were removed. The display face is now Alegreya (above).

## Design tokens

The colour, spacing, motion and utility tokens in `apps/platform/src/theme/` are adapted from the project owner's own `compsys` design system.
