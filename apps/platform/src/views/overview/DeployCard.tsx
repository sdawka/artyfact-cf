import { useHistory } from "@/api/queries";
import styles from "./Overview.module.css";

type Deployable = { id: string; deployment?: { at?: string; url?: string } };

/** "not deployed — unknown" until History carries a deployment. */
export function DeployCard() {
  const { data } = useHistory();
  const deployed = ((data ?? []) as Deployable[]).find((c) => c.deployment);
  return (
    <section className={styles.card} aria-labelledby="deploy-title">
      <h2 id="deploy-title" className={styles.cardTitle}>Deployment</h2>
      {deployed ? (
        <p className={styles.plainText}>
          Deployed at <code>{deployed.id.slice(0, 7)}</code>
          {deployed.deployment?.at ? `, ${deployed.deployment.at}` : ""}.
        </p>
      ) : (
        <p className={styles.plainText}>not deployed — <span className={styles.unknown}>unknown</span></p>
      )}
      <p className={styles.muted}>Deployment status comes from System history. None has been recorded.</p>
    </section>
  );
}
