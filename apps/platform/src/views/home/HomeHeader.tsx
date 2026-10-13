import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { resetClientMode } from "@/api/client";
import { useClientMode, useParts, useSystems } from "@/api/queries";
import { AdminTokenControl } from "@/app/AdminTokenControl";
import { FIXTURE_TITLE, StatePill } from "@/app/StatePill";
import { HomePalette } from "./HomePalette";
import styles from "./home.module.css";

/** Wordmark plus, in fixture mode, the "fixture data" pill and a Retry button. */
export function HomeHeader() {
  const { data: mode } = useClientMode();
  const qc = useQueryClient();
  const systems = useSystems();
  const parts = useParts();
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
      <span className={styles.spacer} />
      <AdminTokenControl />
      <button type="button" className={`u-brackets ${styles.search}`} onClick={() => setPaletteOpen(true)} aria-keyshortcuts="Meta+K Control+K">
        Go to… <kbd className={styles.kbd}>⌘K</kbd>
      </button>
      <HomePalette open={paletteOpen} onOpenChange={setPaletteOpen} systems={systems.data ?? []} parts={parts.data ?? []} />
    </header>
  );
}
