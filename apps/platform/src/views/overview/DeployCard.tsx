import { useDeployments } from "@/api/queries";
import styles from "./Overview.module.css";

/** The live production deployment, else "not deployed — unknown". */
export function DeployCard() {
  const { data } = useDeployments();
  const live = data?.production?.status === "live" ? data.production : data?.history.find((d) => d.kind === "production" && d.status === "live");
  return (
    <section className={styles.card} aria-labelledby="deploy-title">
      <h2 id="deploy-title" className={styles.cardTitle}>Deployment</h2>
      {live ? (
        <p className={styles.plainText}>
          Live at <code>{live.commit.slice(0, 7)}</code>
          {live.systemCommit ? ` (${live.systemCommit})` : ""}
          {live.url && <> · <a href={live.url} target="_blank" rel="noopener noreferrer">{live.url}</a></>}.
        </p>
      ) : (
        <p className={styles.plainText}>not deployed — <span className={styles.unknown}>unknown</span></p>
      )}
    </section>
  );
}
