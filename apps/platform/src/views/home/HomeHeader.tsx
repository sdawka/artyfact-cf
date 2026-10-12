import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { resetClientMode } from "@/api/client";
import { useClientMode } from "@/api/queries";
import { FIXTURE_TITLE, StatePill } from "@/app/StatePill";
import styles from "./home.module.css";

/** Wordmark plus, in fixture mode, the "fixture data" pill and a Retry button. */
export function HomeHeader() {
  const { data: mode } = useClientMode();
  const qc = useQueryClient();
  const retry = () => {
    resetClientMode();
    void qc.invalidateQueries();
  };
  return (
    <header className={styles.header}>
      <Link to="/" className={`wordmark ${styles.wordmark}`} aria-current="page">artyfact</Link>
      {mode === "fixture" && (
        <>
          <StatePill state="fixture" title={FIXTURE_TITLE}>fixture data</StatePill>
          <button type="button" className={`u-brackets ${styles.retry}`} onClick={retry}>Retry API</button>
        </>
      )}
    </header>
  );
}
