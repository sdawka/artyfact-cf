import type { Evaluation } from "../../../shared/api";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import { durationMs } from "./lib";
import styles from "./evaluations.module.css";

const plain = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

/** Question, Method, Raw observations, Interpretation, Limitations and Provenance of one Evaluation. */
export function EvaluationDetail({ evaluation: e }: { evaluation: Evaluation }) {
  const m = useModel();
  const criterion = m.byId(e.criterion)?.item as { claim?: string; title?: string } | undefined;
  const hook = m.byId(e.hook)?.item as { engine?: string; tier?: string; inputs?: Record<string, unknown>; version?: number } | undefined;
  const ms = durationMs(e);
  const provenance = Object.entries(e.provenance ?? {});
  return (
    <div className={styles.detail}>
      <section aria-label="Question">
        <h4>Question</h4>
        <p>{criterion?.claim ?? criterion?.title ?? <span className={styles.muted}>unknown: criterion {e.criterion} is not in this revision</span>}</p>
      </section>
      <section aria-label="Method">
        <h4>Method</h4>
        {hook ? (
          <dl className={styles.facts}>
            <dt>Hook</dt><dd><NodeChip id={e.hook} size="sm" showId /></dd>
            <dt>Engine</dt><dd>{hook.engine ?? "unknown"}</dd>
            <dt>Tier</dt><dd>{hook.tier ?? "unknown"}</dd>
            <dt>Inputs</dt><dd><code>{JSON.stringify(hook.inputs ?? {})}</code></dd>
          </dl>
        ) : (
          <p className={styles.muted}>unknown: hook {e.hook} is not in this revision. Verifier: {e.verifier}</p>
        )}
      </section>
      <section aria-label="Raw observations">
        <h4>Raw observations</h4>
        {e.observations?.length ? (
          <details>
            <summary>{e.observations.length} observation{e.observations.length === 1 ? "" : "s"} (JSON)</summary>
            <pre className={styles.json}>{plain(e.observations)}</pre>
          </details>
        ) : (
          <p className={styles.muted}>none recorded</p>
        )}
      </section>
      <section aria-label="Interpretation">
        <h4>Interpretation</h4>
        <p>{e.interpretation ?? <span className={styles.muted}>none recorded</span>}</p>
      </section>
      <section aria-label="Limitations">
        <h4>Limitations</h4>
        {e.limitations?.length ? (
          <ul>{e.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        ) : (
          <p className={styles.muted}>none recorded</p>
        )}
      </section>
      <section aria-label="Provenance">
        <h4>Provenance</h4>
        <dl className={styles.facts}>
          <dt>Verifier</dt><dd>{e.verifier}</dd>
          <dt>Target</dt><dd><code>{e.targetRef}</code></dd>
          <dt>Started</dt><dd>{e.startedAt}</dd>
          <dt>Duration</dt><dd>{ms === undefined ? "unknown" : `${ms} ms`}</dd>
          {provenance.map(([k, v]) => (
            <div key={k} className={styles.factRow}>
              <dt>{k}</dt><dd><code>{v}</code></dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
