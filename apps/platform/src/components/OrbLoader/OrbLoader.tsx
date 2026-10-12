import { Orb } from "@artyfact/effects";
import styles from "./OrbLoader.module.css";

/** Small orb plus a visible text label in a polite status region. The orb is decorative; the text carries the meaning. */
export function OrbLoader({ label }: { label: string }) {
  return (
    <div className={styles.loader} role="status">
      <div className={styles.orb} aria-hidden="true">
        <Orb preset="apricot" size={0.72} particleCount={3000} interactive={false} strands={3} sparks={0.6} fill={0.35} speed={1.4} />
      </div>
      <p className={styles.label}>{label}</p>
    </div>
  );
}
