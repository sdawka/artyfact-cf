import { useEffect, useState } from "react";
import { SurfaceField } from "@artyfact/effects";
import styles from "./LoadingState.module.css";

/** Readable status in a luminous skeleton frame; no invented progress or isolated ornament. */
export function LoadingState({ label }: { label: string }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setSettled(true), 2600); return () => clearTimeout(timer); }, []);
  return <div className={styles.loader}><div className={styles.frame} role="status">
    <SurfaceField preset="apricot" level={.35} activity={.6} density={.25} paused={settled} />
    <div className={styles.content}><div className={styles.skeleton} aria-hidden="true"><span /><span /><span /></div><p className={styles.label}>{label}</p></div>
  </div></div>;
}
