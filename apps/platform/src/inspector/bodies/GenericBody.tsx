import { KeyValue } from "@/components/KeyValue/KeyValue";
import type { IndexEntry } from "@/model/index";

/** Fallback What body: a key/value dump of the raw model object. */
export function GenericBody({ entry }: { entry: IndexEntry }) {
  const item = (entry.item ?? {}) as Record<string, unknown>;
  return <KeyValue data={item} omit={["id", "parent"]} />;
}
