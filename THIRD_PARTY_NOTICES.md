# Third-party notices

artyfact is licensed under Apache-2.0. This file records components that are not covered by that licence or need a note. It is not a full dependency inventory; npm dependencies keep their own licences in `node_modules`.

## elkjs

Used by the Map and Journeys views for graph layout (`apps/platform`, dependency `elkjs`). elkjs is offered under `EPL-2.0 OR GPL-3.0-or-later`. This project uses it under EPL-2.0. EPL-2.0 is a file-level copyleft licence and allows use from Apache-2.0 code as long as elkjs is not modified. artyfact does not modify it. The built SPA bundles the unmodified library, so the source stays available from the upstream project (https://github.com/kieler/elkjs) and the EPL-2.0 text is in `licenses/elkjs-LICENSE.md`. If a copy of elkjs is ever patched here, those patched files must be published under EPL-2.0.

## Brilon (display font)

Not shipped. An earlier version of the theme loaded a Brilon woff2 file, but its licence was never confirmed, so the file and its `@font-face` rule were removed. The display face is Georgia. If the licence is confirmed later, restoring the font is a single revert.

## Design tokens

The colour, spacing, motion and utility tokens in `apps/platform/src/theme/` are adapted from the project owner's own `compsys` design system.
