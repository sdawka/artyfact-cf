import { useNavigate, useSearchParams } from "react-router";
import { useHistory, useSystems } from "@/api/queries";
import { useModel } from "@/model/useModel";
import { useSystemRoute, viewPath } from "@/model/useSelection";
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
  const navigate = useNavigate();
  const { bundle } = useModel();
  const { data: systems = [] } = useSystems();
  const { data: commits = [] } = useHistory();
  const candidates = (params.get("candidates") ?? "").split(",").filter(Boolean);
  const go = (s: string, r: string) => {
    const qs = params.toString();
    void navigate(`${viewPath(s, r, view ?? "overview")}${qs ? `?${qs}` : ""}`);
  };
  const systemOptions = systems.some((s) => s.systemId === systemId)
    ? systems
    : [{ systemId, title: bundle.model.system.name }, ...systems];
  const revOptions = ["head", ...commits.map((c) => c.id)];
  if (!revOptions.includes(rev)) revOptions.push(rev);
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
          {revOptions.map((r) => (
            <option key={r} value={r}>{r === "head" ? "head" : r.slice(0, 10)}</option>
          ))}
        </select>
      </label>
      <StatePill state={revisionState(rev, candidates)} />
    </div>
  );
}
