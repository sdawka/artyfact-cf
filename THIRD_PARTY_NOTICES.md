# Third-party notices

artyfact is licensed under Apache-2.0. This file records components that are not covered by that licence or need a note. It is not a full dependency inventory; npm dependencies keep their own licences in `node_modules`.

## elkjs

Used by the Map and Journeys views for graph layout (`apps/platform`, dependency `elkjs`). elkjs is offered under `EPL-2.0 OR GPL-3.0-or-later`. This project uses it under EPL-2.0. EPL-2.0 is a file-level copyleft licence and allows use from Apache-2.0 code as long as elkjs is not modified. artyfact does not modify it. The built SPA bundles the unmodified library, so the source stays available from the upstream project (https://github.com/kieler/elkjs) and the EPL-2.0 text is in `licenses/elkjs-LICENSE.md`. If a copy of elkjs is ever patched here, those patched files must be published under EPL-2.0.

## React Bits (Orb effect)

The `Orb` in `packages/effects` is a TypeScript port of the Crystalized Ball component from React Bits (https://github.com/DavidHDev/react-bits). It is **not** covered by Apache-2.0: those files stay under the React Bits licence below (MIT + Commons Clause v1.0). In short, the component may be used inside an application, website or product, but not sold, sublicensed or redistributed on its own, in a bundle or as a ported version. For that reason `@artyfact/effects` is `private` and must never be published to npm or extracted as a standalone library. Each covered file carries a header saying so.

Covered files:

- `packages/effects/src/orb/Orb.tsx`
- `packages/effects/src/orb/data.ts`
- `packages/effects/src/orb/engine.ts`
- `packages/effects/src/orb/palette.ts`
- `packages/effects/src/orb/presets.ts`
- `packages/effects/src/orb/shaders.ts`

Everything else in `packages/effects` (including `AmbientField`, its shaders and engine, colour parsing, the pointer registry and the provider) is original Apache-2.0 code.

Licence text (from https://raw.githubusercontent.com/DavidHDev/react-bits/main/LICENSE.md):

> MIT + Commons Clause License Condition v1.0
>
> Copyright (c) 2026 David Haz
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, and distribute the Software **as part of an application, website, or product**, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> ## Commons Clause Restriction
>
> You may use this Software, including for any commercial purpose, **so long as you do not sell, sublicense, or redistribute the components themselves-whether alone, in a bundle, or as a ported version.**
>
> ## No Warranty
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## ogl

WebGL helper used by `packages/effects` (dependency `ogl`). Released under the Unlicense (public domain dedication); no conditions apply. Upstream: https://github.com/oframe/ogl.

## Brilon (display font)

Not shipped. An earlier version of the theme loaded a Brilon woff2 file, but its licence was never confirmed, so the file and its `@font-face` rule were removed. The display face is Georgia. If the licence is confirmed later, restoring the font is a single revert.

## Design tokens

The colour, spacing, motion and utility tokens in `apps/platform/src/theme/` are adapted from the project owner's own `compsys` design system.
