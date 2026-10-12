/**
 * Inspector body registry. To add a body, create `src/inspector/bodies/<Kind>Body.tsx` that calls
 * `registerBody("<kind>", Component)` at module top level, importing from "./registry". Every
 * `.tsx` file in this directory is imported eagerly below, so no edit to this file is needed.
 * Registering from a (lazy) view module also works; the Inspector re-renders when it loads.
 */
export { BodyFor, getBody, registerBody, useBody, type BodyComponent, type BodyProps } from "./registry";
export { GenericBody } from "./GenericBody";

import.meta.glob(["./*.tsx", "!./GenericBody.tsx", "!./*.test.tsx"], { eager: true });
