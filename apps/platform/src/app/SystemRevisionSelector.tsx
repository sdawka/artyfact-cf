import { useNavigate, useParams, useSearchParams } from "react-router";
import { useRevisions, useSystems } from "@/api/queries";
import { revisionGroups } from "@/model/revisions";
import { useModel } from "@/model/useModel";
import { thingPath, useSystemRoute, viewPath } from "@/model/useSelection";
import { StatePill, type RevisionState } from "./StatePill";
import styles from "./SystemRevisionSelector.module.css";

export function revisionState(rev: string, candidates: string[]): RevisionState {
  if (rev === "deployed") return "deployed";
  if (candidates.length || rev.startsWith("candidate")) return "candidate";
  return "canonical";
}

/** System + revision pickers. Changing either keeps the current view and global params. */
export function SystemRevisionSelector() {
  const { systemId, rev, view } = useSystemRoute();
  const [params] = useSearchParams();
  const { thingId } = useParams();
  const navigate = useNavigate();
  const { bundle } = useModel();
  const { data: systems = [] } = useSystems();
  const { data: revisions = [] } = useRevisions();
  const candidates = (params.get("candidates") ?? "").split(",").filter(Boolean);
  const go = (s: string, r: string) => {
    const qs = params.toString();
    const path = s === systemId && thingId ? `${thingPath(s, r, thingId)}${view ? `/${view}` : ""}` : viewPath(s, r, view ?? "overview");
    void navigate(`${path}${qs ? `?${qs}` : ""}`);
  };
  const systemOptions = systems.some((s) => s.systemId === systemId)
    ? systems
    : [{ systemId, title: bundle.model.system.name }, ...systems];
  const revOptions = revisions.some((r) => r.id === "head") ? revisions : [{ id: "head", kind: "head" as const, label: "head" }, ...revisions];
  return (
    <div className={styles.selector}>
      <label className={styles.field}>
        <span className="sr-only">System</span>
        <select className={styles.select} value={systemId} onChange={(e) => go(e.target.value, "head")}>
          {systemOptions.map((s) => (
            <option key={s.systemId} value={s.systemId}>{s.title}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className="sr-only">Revision</span>
        <select className={styles.select} value={rev} onChange={(e) => go(systemId, e.target.value)}>
          {revisionGroups(revOptions, rev).map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <StatePill state={revisionState(rev, candidates)} />
    </div>
  );
}
