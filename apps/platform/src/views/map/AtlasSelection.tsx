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
      <button className={styles.detailsAction} onClick={onDetails}>Details</button>
      {entry.type !== "external" && index.children(id).length > 0 && id !== graph.scope && (graph.scope !== ENVIRONMENT_SCOPE || id !== index.model.system.id) && <button onClick={() => onEnter(id)}>Enter {entry.name}</button>}
      <button onClick={() => setConnections((open) => !open)} aria-expanded={connections}>Connections ({members.length})</button>
      <button className={styles.clearAction} onClick={onClear} aria-label="Clear selection">×</button>
    </div>
    {connections && <section ref={setConnectionSurface} className={styles.connections} aria-label="Selected connections">
      {members.length === 0 ? <p>No connections cross this boundary.</p> : <ul>{members.map((member, i) => <li key={`${member.from}-${member.to}-${member.rel}-${i}`}>
        <div className={styles.endpoint}><span>{pathname(member.from)}</span><button onClick={() => onLocate(member.from)}>Locate {index.byId(member.from)?.name ?? member.from}</button></div>
        <p className={styles.relation}>{member.rel} <span aria-hidden="true">→</span> {member.label ? `${member.label} · ` : ""}{member.certainty}</p>
        <div className={styles.endpoint}><span>{pathname(member.to)}</span><button onClick={() => onLocate(member.to)}>Locate {index.byId(member.to)?.name ?? member.to}</button></div>
      </li>)}</ul>}
    </section>}
  </aside>;
}
