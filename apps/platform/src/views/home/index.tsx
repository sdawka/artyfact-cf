import type { SystemSummary } from "../../../shared/api";
import { useSystems } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { OrbLoader } from "@/components/OrbLoader/OrbLoader";
import { useNow } from "@/model/time";
import { HomeHeader } from "./HomeHeader";
import { SystemCard } from "./SystemCard";
import styles from "./home.module.css";

/** README section on importing a project with `artyfact init`. */
const INIT_DOCS = "https://github.com/sdawka/artyfact-cf#readme";

export interface HomeContentProps {
  systems: SystemSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?(): void;
}

/** The body of Home for each state: loading, error, empty, or the card grid. */
export function HomeContent({ systems, isLoading, isError, onRetry }: HomeContentProps) {
  const now = useNow(60_000);
  if (isError)
    return (
      <EmptyState
        title="Could not reach the platform API."
        action={onRetry && <button type="button" className={`u-brackets ${styles.retry}`} onClick={onRetry}>Try again</button>}
      />
    );
  if (isLoading || !systems) return <OrbLoader label="Loading Systems…" />;
  if (systems.length === 0)
    return (
      <EmptyState title="No Systems yet." orb action={<a className="u-marker" href={INIT_DOCS}>Import one with artyfact init</a>}>
        <p>
          Run <code>npx artyfact init --dir &lt;project&gt;</code> in a project with a <code>system.yaml</code>.
        </p>
      </EmptyState>
    );
  return (
    <ul className={styles.grid} aria-label="Systems">
      {systems.map((s) => <SystemCard key={s.systemId} system={s} now={now} />)}
    </ul>
  );
}

/** `/`: every System on this platform, outside the System shell. */
export default function HomeView() {
  const { data, isLoading, isError, refetch } = useSystems();
  return (
    <div className={styles.page}>
      <HomeHeader />
      <main id="main" className={styles.main} tabIndex={-1}>
        <h1 className={styles.h1}>Systems</h1>
        <HomeContent systems={data} isLoading={isLoading} isError={isError} onRetry={() => void refetch()} />
      </main>
    </div>
  );
}

