import { createElement, useSyncExternalStore, type ComponentType } from "react";
import type { IndexEntry } from "@/model/index";
import type { AnyKind } from "@/model/types";
import { GenericBody } from "./GenericBody";

/** Props every Inspector "What" body receives. */
export interface BodyProps {
  entry: IndexEntry;
}
export type BodyComponent = ComponentType<BodyProps>;

const registry = new Map<string, BodyComponent>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

/** Registers the What-tab body for a kind (last registration wins). Returns an unregister function. */
export function registerBody(kind: AnyKind | (string & {}), component: BodyComponent): () => void {
  registry.set(kind, component);
  emit();
  return () => {
    if (registry.get(kind) === component) {
      registry.delete(kind);
      emit();
    }
  };
}

export const getBody = (kind: string): BodyComponent => registry.get(kind) ?? GenericBody;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The registered body for `kind`, re-rendering when registrations change (lazy views register late). */
export function useBody(kind: string): BodyComponent {
  useSyncExternalStore(subscribe, () => version, () => version);
  return getBody(kind);
}

/** Renders the registered body for `entry.kind`, or GenericBody. */
export function BodyFor({ entry }: BodyProps) {
  return createElement(useBody(entry.kind), { entry });
}
