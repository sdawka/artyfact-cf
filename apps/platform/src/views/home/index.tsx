import type { PartSummary, SystemSummary } from "../../../shared/api";
import { useParts, useSystems } from "@/api/queries";
import { Card } from "@/components/Card/Card";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { LoadingState } from "@/components/LoadingState/LoadingState";
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
  if (isLoading || !systems) return <LoadingState label="Loading Systems…" />;
  if (systems.length === 0)
    return (
      <EmptyState title="No Systems yet." surface action={<a className="u-marker" href={INIT_DOCS}>Import one with artyfact init</a>}>
        <p>
          Run <code>npx artyfact init --dir &lt;project&gt;</code> in a project with a root <code>node.yaml</code>.
        </p>
      </EmptyState>
    );
  return (
    <ul className={styles.grid} aria-label="Systems">
      {systems.map((s) => <SystemCard key={s.systemId} system={s} now={now} />)}
    </ul>
  );
}

export interface PartsContentProps {
  parts: PartSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/** The public catalog only contains shared packages; System-private packages are intentionally absent. */
export function PartsContent({ parts, isLoading, isError }: PartsContentProps) {
  if (isError) return <EmptyState title="Could not load reusable Parts." />;
  if (isLoading || !parts) return <LoadingState label="Loading reusable Parts…" />;
  const sharedParts = parts.filter((part) => part.scope.kind === "shared");
  if (sharedParts.length === 0) return <EmptyState title="No reusable Parts published yet."><p>System-private Parts stay inside their System.</p></EmptyState>;
  return <ul className={styles.grid} aria-label="Reusable Parts">
    {sharedParts.map((part) => (
      <Card as="li" key={`${part.partId}@${part.version}`} to={`/parts/${encodeURIComponent(part.partId)}/${encodeURIComponent(part.version)}`} title={part.name || part.partId} headingLevel={3}>
        <p className={styles.meta}><code>{part.partId}@{part.version}</code><span>Shared</span></p>
        {part.description && <p className={styles.partDescription}>{part.description}</p>}
        <p className={styles.footer}><span>{part.dependencies.length} dependencies</span><span>published {part.publishedAt || "unknown"}</span></p>
      </Card>
    ))}
  </ul>;
}

/** `/`: every System on this platform, outside the System shell. */
export default function HomeView() {
  const { data, isLoading, isError, refetch } = useSystems();
  const parts = useParts();
  return (
    <div className={styles.page}>
      <HomeHeader />
      <main id="main" className={styles.main} tabIndex={-1}>
        <h1 className={styles.h1}>Systems</h1>
        <HomeContent systems={data} isLoading={isLoading} isError={isError} onRetry={() => void refetch()} />
        <section className={styles.parts} aria-labelledby="parts-title">
          <h2 id="parts-title" className={styles.h2}>Reusable Parts</h2>
          <PartsContent parts={parts.data} isLoading={parts.isLoading} isError={parts.isError} />
        </section>
      </main>
    </div>
  );
}

