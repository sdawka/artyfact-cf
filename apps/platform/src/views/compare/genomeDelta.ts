import { useMemo } from "react";
import type { SemanticChange, SemanticDelta } from "@artyfact/semantic";
import type { ModelDelta } from "../../../shared/api";
import { useModelBundle } from "@/api/queries";
import { buildIndex, type ModelIndex } from "@/model/index";
import { useSystemRoute } from "@/model/useSelection";

/** Field values shown when a side's model could not be loaded (never pretend a value is "none"). */
const unknownFields = (fields: string[]) => Object.fromEntries(fields.map((f) => [f, "unknown"]));

/**
 * The API's id-level delta (`added`/`removed`/`changed {id, fields}`) joined with the node objects of both sides, in
 * the shape `SemanticDelta` renders (before/after per field). Pure: `before`/`after` are the two sides' indexes, or
 * undefined while they load or when they fail.
 */
export function toSemanticDelta(delta: ModelDelta, before?: ModelIndex, after?: ModelIndex): SemanticDelta {
  const kindOf = (id: string) => after?.byId(id)?.kind ?? before?.byId(id)?.kind ?? "node";
  const changes: SemanticChange[] = [
    ...delta.added.map((id) => ({ id, kind: kindOf(id), before: null, after: after?.byId(id)?.item ?? {}, fieldsChanged: [] })),
    ...delta.changed.map(({ id, fields }) => ({
      id,
      kind: kindOf(id),
      before: before?.byId(id)?.item ?? unknownFields(fields),
      after: after?.byId(id)?.item ?? unknownFields(fields),
      fieldsChanged: fields,
    })),
    ...delta.removed.map((id) => ({ id, kind: kindOf(id), before: before?.byId(id)?.item ?? {}, after: null, fieldsChanged: [] })),
  ];
  return { changes };
}

/** {@link toSemanticDelta} with both sides' model bundles loaded by revision. */
export function useSemanticDelta(delta: ModelDelta | null | undefined, fromRev: string | null | undefined, toRev: string): SemanticDelta | null {
  const { systemId } = useSystemRoute();
  const needs = !!delta && (delta.changed.length > 0 || delta.added.length > 0 || delta.removed.length > 0);
  const from = useModelBundle(systemId, needs && fromRev ? fromRev : toRev);
  const to = useModelBundle(systemId, toRev);
  const fromIndex = useMemo(() => (fromRev && from.data ? buildIndex(from.data) : undefined), [fromRev, from.data]);
  const toIndex = useMemo(() => (to.data ? buildIndex(to.data) : undefined), [to.data]);
  return useMemo(() => (delta ? toSemanticDelta(delta, fromIndex, toIndex) : null), [delta, fromIndex, toIndex]);
}
