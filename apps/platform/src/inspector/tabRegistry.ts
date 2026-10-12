import { useSyncExternalStore, type ComponentType } from "react";
import type { IndexEntry } from "@/model/index";
import { TAB_COMPONENTS, type InspectorTab } from "./tabs";

export type TabComponent = ComponentType<{ entry: IndexEntry }>;

const registry = new Map<InspectorTab, TabComponent>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Replaces the content of an Inspector tab for every kind (e.g. the Work slice registers
 * "changes", the Evaluations slice "evidence"). Last registration wins; returns an unregister.
 * Call it at module top level from a view module or from a file in `inspector/bodies/`.
 */
export function registerTab(tab: InspectorTab, component: TabComponent): () => void {
  registry.set(tab, component);
  emit();
  return () => {
    if (registry.get(tab) === component) {
      registry.delete(tab);
      emit();
    }
  };
}

/** The registered component for `tab`, else the shell's default; re-renders on registration. */
export function useTabComponent(tab: InspectorTab): TabComponent {
  useSyncExternalStore(subscribe, () => version, () => version);
  return registry.get(tab) ?? (TAB_COMPONENTS[tab] as TabComponent);
}
