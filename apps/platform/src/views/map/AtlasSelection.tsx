import { Button, IconButton } from "@/components/ui";
import { Row, RowList } from "@/components/RowList/RowList";
import { Cross2Icon } from "@radix-ui/react-icons";
import { useState } from "react";
import { useModel } from "@/model/useModel";
import { selectedBoundaryEdges } from "./atlasConnections";
import { ENVIRONMENT_SCOPE, type MapGraph } from "./useMapGraph";
import { useAtlasReveal } from "./useAtlasReveal";
import styles from "./MapView.module.css";

export function AtlasSelection({ id, graph, onEnter, onDetails, onLocate, onClear }: {
  id: string | null; graph: MapGraph; onEnter: (id: string) => void; onDetails: () => void; onLocate: (id: string) => void; onClear: () => void;
}) {
  const { index, path } = useModel();
  const [connections, setConnections] = useState(false);
  const [surface, setSurface] = useState<HTMLElement | null>(null);
  const [connectionSurface, setConnectionSurface] = useState<HTMLElement | null>(null);
  useAtlasReveal(surface, Boolean(id), 140);
  useAtlasReveal(connectionSurface, connections, 140);
  const entry = id ? index.byId(id) : undefined;
  if (!entry || !id) return null;
  const edges = selectedBoundaryEdges(graph, id, index);
  const members = edges.flatMap((edge) => edge.members);
  const pathname = (endpoint: string) => path(endpoint).map((part) => part.name).join(" / ") || index.byId(endpoint)?.name || endpoint;
  return <aside ref={setSurface} className={styles.selection} aria-label="Map selection">
    <div className={styles.summary}>
      <div className={styles.selectedName}><strong>{entry.name}</strong><span>{entry.kind}</span></div>
      <Button size="compact" variant="primary" onClick={onDetails}>Details</Button>
      {entry.type !== "external" && index.children(id).length > 0 && id !== graph.scope && (graph.scope !== ENVIRONMENT_SCOPE || id !== index.model.system.id) && <Button size="compact" onClick={() => onEnter(id)}>Enter {entry.name}</Button>}
      <Button size="compact" onClick={() => setConnections((open) => !open)} aria-expanded={connections}>Connections ({members.length})</Button>
      <IconButton size="compact" className={styles.clearAction} onClick={onClear} label="Clear selection"><Cross2Icon /></IconButton>
    </div>
    {connections && <section ref={setConnectionSurface} className={styles.connections} aria-label="Selected connections">
      {members.length === 0 ? <p>No connections cross this boundary.</p> : <RowList label="Connections" density="compact" className={styles.connectionList}>{members.map((member, i) => <Row
        key={`${member.from}-${member.to}-${member.rel}-${i}`}
        title={<>{pathname(member.from)} <span aria-hidden="true">→</span> {pathname(member.to)}</>}
        meta={`${member.rel}${member.label ? `, ${member.label}` : ""}, ${member.certainty}`}
        trailing={<>
          <Button variant="ghost" size="compact" onClick={() => onLocate(member.from)}>Show {index.byId(member.from)?.name ?? member.from} on map</Button>
          <Button variant="ghost" size="compact" onClick={() => onLocate(member.to)}>Show {index.byId(member.to)?.name ?? member.to} on map</Button>
        </>}
      />)}</RowList>}
    </section>}
  </aside>;
}
