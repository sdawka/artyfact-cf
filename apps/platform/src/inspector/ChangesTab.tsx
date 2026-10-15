import { useRealizationsTouching } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import type { IndexEntry } from "@/model/index";
import { titleOf, useKindViews } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";

const FAILED = new Set(["failed", "error", "rejected"]);

/** Evolutions that touch the node, and the realizations working on them with their status. A group with nothing in it is not shown. */
export function ChangesTab({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const kinds = useKindViews();
  const href = useKeepParams();
  const { data: realizations, isLoading } = useRealizationsTouching(entry.id);
  const evolutions = (m.index.model.evolutions ?? []).filter((e) => e.affectedNodes.includes(entry.id));
  if (!evolutions.length && !realizations.length) {
    return <EmptyState title={isLoading ? "Loading changes…" : "No evolutions touch this object."} />;
  }
  return (
    <>
      {evolutions.length > 0 && (
        <Section title="Evolutions" headingLevel={3} count={evolutions.length}>
          <RowList label="Evolutions">
            {evolutions.map((e) => {
              const node = m.byId(e.id);
              return <Row key={e.id} to={href("work", { evolution: e.id })} title={node ? titleOf(node, kinds.of(node.kind)) : e.id}
                meta={<MetaLine items={[{ value: e.id, code: true }]} />}
                status={<StatusText status={e.state} />} />;
            })}
          </RowList>
        </Section>
      )}
      {realizations.length > 0 && (
        <Section title="Realizations" headingLevel={3} count={realizations.length}>
          <RowList label="Realizations">
            {realizations.map((r) => (
              <Row key={r.id} to={href("work", { evolution: r.evolution, realization: r.id })} title={<code>{r.id}</code>}
                meta={<MetaLine items={[{ label: "agent", value: r.agent.id }, { label: "target", value: r.target }, ...(r.candidate ? [{ label: "candidate", value: r.candidate, code: true }] : [])]} />}
                status={<StatusText status={r.status} tone={FAILED.has(r.status) ? "fail" : "neutral"} />}
                tone={FAILED.has(r.status) ? "fail" : "neutral"} />
            ))}
          </RowList>
        </Section>
      )}
    </>
  );
}
