import { Button } from "@/components/ui";
import { Link } from "react-router";
import type { PartSummary, SystemSummary } from "../../../shared/api";
import { useParts, useSystems } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { EntryLayout } from "@/components/EntryLayout/EntryLayout";
import { LoadingState } from "@/components/LoadingState/LoadingState";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Section } from "@/components/Section/Section";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { relTime, useNow } from "@/model/time";
import { HomeHeader } from "./HomeHeader";
import { NeedsYou } from "./NeedsYou";
import { SystemRow, SystemsHeader } from "./SystemRow";
import { sortByAttention } from "./signifiers";
import styles from "./home.module.css";

/** README section on importing a project with `artyfact init`. */
const INIT_DOCS = "https://github.com/sdawka/artyfact-cf#readme";

export interface HomeContentProps {
  systems: SystemSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry?(): void;
}

/** The body of Home for each state: loading, error, empty, or the ledger and the Systems register. */
export function HomeContent({ systems, isLoading, isError, onRetry }: HomeContentProps) {
  const now = useNow(60_000);
  if (isError)
    return (
      <EmptyState
        kind="error"
        title="Could not reach the platform API."
        action={onRetry && <Button type="button" variant="secondary" onClick={onRetry}>Try again</Button>}
      />
    );
  if (isLoading || !systems) return <LoadingState label="Loading Systems…" />;
  if (systems.length === 0)
    return (
      <EmptyState
        title="No Systems yet."
        surface
        action={<span className={styles.emptyActions}><a className="u-marker" href={INIT_DOCS}>Import one with artyfact init</a><Link to="/start">Start a System</Link></span>}
      >
        <p>
          Run <code>npx artyfact init --dir &lt;project&gt;</code> in a project with a root <code>node.yaml</code>.
        </p>
      </EmptyState>
    );
  return (
    <>
      <NeedsYou systems={systems} />
      <Section title="Systems" count={systems.length}>
        <SystemsHeader />
        <ul className={styles.register} aria-label="Systems">
          {sortByAttention(systems).map((s) => <SystemRow key={s.systemId} system={s} now={now} />)}
        </ul>
      </Section>
    </>
  );
}

export interface PartsContentProps {
  parts: PartSummary[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/** The public catalog only contains shared packages; System-private packages are intentionally absent. */
export function PartsContent({ parts, isLoading, isError }: PartsContentProps) {
  const now = useNow(60_000);
  if (isError) return <EmptyState title="Could not load Shared Parts." />;
  if (isLoading || !parts) return <p className={styles.quiet} role="status">Loading Parts…</p>;
  const sharedParts = parts.filter((part) => part.scope.kind === "shared");
  if (sharedParts.length === 0) return <EmptyState title="No Shared Parts published yet."><p>Private Parts stay inside their System.</p></EmptyState>;
  return <>
    <div className={`${styles.regHead} ${styles.partCols}`} aria-hidden="true">
      <span>Name</span><span>Version</span><span>Description</span><span>Dependencies</span><span>Published</span>
    </div>
    <ul className={styles.register} aria-label="Shared Parts">
      {sharedParts.map((part) => {
        const deps = part.dependencies.length;
        return (
          <li key={`${part.partId}@${part.version}`} className={styles.regRow}>
            <Link to={`/parts/${encodeURIComponent(part.partId)}/${encodeURIComponent(part.version)}`} className={`u-selectable ${styles.regLink} ${styles.partCols}`} aria-label={part.name || part.partId}>
              <span className={styles.cellName}>
                <span className={styles.rowTitle}>{part.name || part.partId}</span>
                <MetaLine items={[{ value: `${part.partId}@${part.version}`, code: true }]} />
              </span>
              <span className={styles.cell}><span className={styles.cellLabel}>Version </span><code>{part.version}</code></span>
              <span className={`${styles.cell} ${styles.cellDescription}`}>{part.description || <span className={styles.quiet}>No description.</span>}</span>
              <span className={styles.cell}>{deps === 0 ? "no dependencies" : `${deps} ${deps === 1 ? "dependency" : "dependencies"}`}</span>
              <span className={styles.cell} title={part.publishedAt || undefined}>{part.publishedAt ? relTime(part.publishedAt, now) : "unknown"}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  </>;
}

/** `/`: every System on this platform, outside the System shell. */
export default function HomeView() {
  const { data, isLoading, isError, refetch } = useSystems();
  const parts = useParts();
  return (
    <EntryLayout header={<HomeHeader />}>
      <PageHeader
        title="Systems"
        purpose="Systems on this platform and what waits on you."
        context={null}
        primary={<Button asChild variant="primary"><Link to="/start">Start a System</Link></Button>}
      />
      <HomeContent systems={data} isLoading={isLoading} isError={isError} onRetry={() => void refetch()} />
      <Section title="Shared Parts" id="parts">
        <PartsContent parts={parts.data} isLoading={parts.isLoading} isError={parts.isError} />
      </Section>
    </EntryLayout>
  );
}
