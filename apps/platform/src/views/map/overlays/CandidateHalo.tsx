import { Link } from "react-router";
import { useKeepParams } from "@/model/useSelection";
import styles from "./overlays.module.css";

/**
 * Bracket halo for nodes touched by selected candidates; a double bracket and an "overlap" chip when 2+ touch it. The
 * chip links to Review with those candidates preselected for composition.
 */
export function CandidateHalo({ candidates }: { candidates: readonly string[] }) {
  const href = useKeepParams();
  if (!candidates.length) return null;
  const overlap = candidates.length > 1;
  return (
    <>
      <span className={styles.halo} data-overlap={overlap || undefined} aria-hidden="true" />
      {overlap && (
        <Link
          className={`nodrag nopan ${styles.overlap}`}
          to={href("review", { candidates: candidates.join(","), evolution: null, realization: null, panel: null })}
          onClick={(e) => e.stopPropagation()}
          title={`Review ${candidates.join(", ")}`}
        >
          overlap · {candidates.length}
        </Link>
      )}
      <span className="sr-only">Touched by {candidates.join(", ")}</span>
    </>
  );
}
