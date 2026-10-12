/** The example System's selection, shared between the hydrated explorer and the lazily mounted effects. */
export type SystemSelection = { layer: number; subject: number };
type Listener = (selection: SystemSelection) => void;
let current: SystemSelection = { layer: 0, subject: 0 };
const listeners = new Set<Listener>();
export const currentSelection = () => current;
export function publishSelection(selection: SystemSelection) {
  if (selection.layer === current.layer && selection.subject === current.subject) return;
  current = selection;
  for (const listener of listeners) listener(selection);
}
export function subscribeSelection(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
