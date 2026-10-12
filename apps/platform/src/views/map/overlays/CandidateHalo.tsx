import styles from "./overlays.module.css";

/** Bracket halo for nodes touched by selected candidates; a double bracket and "overlap" chip when 2+ touch it. */
export function CandidateHalo({ candidates }: { candidates: readonly string[] }) {
  if (!candidates.length) return null;
  const overlap = candidates.length > 1;
  return (
    <>
      <span className={styles.halo} data-overlap={overlap || undefined} aria-hidden="true" />
      {overlap && <span className={styles.overlap}>overlap · {candidates.length}</span>}
      <span className="sr-only">Touched by {candidates.join(", ")}</span>
    </>
  );
}
