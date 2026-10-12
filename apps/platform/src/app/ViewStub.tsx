import { NodeChip } from "@/components/NodeChip/NodeChip";
import { VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useSelection } from "@/model/useSelection";

/** Placeholder body for a view not built yet: the view name plus the current focus and layer. */
export function ViewStub({ view }: { view: ViewName }) {
  const { focusId, layer } = useSelection();
  return (
    <section aria-labelledby="view-title">
      <h1 id="view-title">{VIEW_LABELS[view]}</h1>
      <p>
        Layer: <code>{layer}</code>
      </p>
      <p>Focus: {focusId ? <NodeChip id={focusId} showId /> : <span>none</span>}</p>
    </section>
  );
}
