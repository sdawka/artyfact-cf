import { createElement, useSyncExternalStore, type ComponentType } from "react";
import type { IndexEntry } from "@/model/index";
import { NodeBody } from "../NodeBody";
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
export function registerBody(kind: string, component: BodyComponent): () => void {
  registry.set(kind, component);
  emit();
  return () => {
    if (registry.get(kind) === component) {
      registry.delete(kind);
      emit();
    }
  };
}

/** The registered body for `entry.kind`; else `NodeBody` (view-hint fields) for Genome nodes, `GenericBody` otherwise. */
export const getBody = (entry: Pick<IndexEntry, "kind" | "type">): BodyComponent =>
  registry.get(entry.kind) ?? (entry.type === "node" ? NodeBody : GenericBody);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The body for `entry`, re-rendering when registrations change (lazy views register late). */
export function useBody(entry: Pick<IndexEntry, "kind" | "type">): BodyComponent {
  useSyncExternalStore(subscribe, () => version, () => version);
  return getBody(entry);
}

/** Renders the body for `entry` (see `getBody`). */
export function BodyFor({ entry }: BodyProps) {
  return createElement(useBody(entry), { entry });
}
