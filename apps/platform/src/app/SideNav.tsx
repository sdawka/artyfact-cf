import { ArchiveIcon, ArrowRightIcon, CheckCircledIcon, CheckIcon, CodeIcon, CommitIcon, CounterClockwiseClockIcon, DashboardIcon, GlobeIcon, MixIcon, RocketIcon, TriangleUpIcon } from "@radix-ui/react-icons";
import { NavLink } from "react-router";
import { useKindViews, VIEW_GLYPHS, VIEW_GROUPS, VIEW_KINDS, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useReviewCount } from "@/model/useReviewCount";
import { useWorkCount } from "@/model/useWorkCount";
import { useKeepParams, useSystemRoute } from "@/model/useSelection";
import styles from "./SideNav.module.css";

const NAV_ICONS: Record<ViewName, typeof GlobeIcon> = {
  map: GlobeIcon, overview: DashboardIcon, journeys: ArrowRightIcon, theory: TriangleUpIcon,
  code: CodeIcon, work: CommitIcon, review: CheckCircledIcon, evaluations: CheckIcon,
  changelog: CounterClockwiseClockIcon, compare: MixIcon, phenome: RocketIcon,
};

/** Every view on the rail, in rail order (Overview, then Genome, Proteome, Phenome). */
export const NAV_VIEWS: { view: ViewName; glyph: string }[] = VIEW_GROUPS.flatMap((g) =>
  g.views.map((view) => ({ view, glyph: VIEW_GLYPHS[view] })),
);

function NavItem({ view, href, count = 0 }: { view: ViewName; href: string; count?: number }) {
  const label = VIEW_LABELS[view];
  const Icon = NAV_ICONS[view];
  return (
    <li>
      <NavLink
        to={href}
        className={`u-brackets ${styles.link}`}
        title={label}
        aria-label={count > 0 ? `${label}, ${count} waiting` : undefined}
      >
        <span className={styles.glyph} aria-hidden="true"><Icon /></span>
        <span className={styles.label}>{label}</span>
        {count > 0 && <span className={styles.count} data-tone="attention">{count}</span>}
      </NavLink>
    </li>
  );
}

/** Overview, then one group per layer headed by its name with its question beneath. Every link keeps the global params. */
export function SideNav({ onNavigate }: { onNavigate?: () => void } = {}) {
  const href = useKeepParams();
  const { systemId, rev } = useSystemRoute();
  const views = useKindViews();
  const reviewCount = useReviewCount();
  const workCount = useWorkCount();
  // A view that needs a kind (Journeys, Theory) shows only when the System's templates declare it.
  const shown = (v: ViewName) => !VIEW_KINDS[v] || views.declares(VIEW_KINDS[v]);
  const item = (v: ViewName) => <NavItem key={v} view={v} href={href(v)} count={v === "review" ? reviewCount : v === "work" ? workCount : 0} />;
  return (
    <nav className={`shell-nav ${styles.nav}`} aria-label="Views" onClick={(event) => { if ((event.target as HTMLElement).closest("a")) onNavigate?.(); }}>
      {VIEW_GROUPS.map((g) =>
        g.label === null ? (
          <ul key="top" className={styles.list}>
            {g.views.filter(shown).map(item)}
          </ul>
        ) : (
          <div
            key={g.label}
            role="group"
            aria-labelledby={`nav-group-${g.label}`}
            aria-describedby={g.question ? `nav-question-${g.label}` : undefined}
            className={styles.group}
          >
            <p id={`nav-group-${g.label}`} className={styles.groupHead}>{g.label}</p>
            {g.question && <p id={`nav-question-${g.label}`} className={styles.question}>{g.question}</p>}
            <ul className={styles.list}>
              {g.views.filter(shown).map(item)}
            </ul>
          </div>
        ),
      )}
      <NavLink className={styles.link} to={`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/parts`} title="Private Parts"><span className={styles.glyph} aria-hidden="true"><ArchiveIcon /></span><span className={styles.label}>Private Parts</span></NavLink>
    </nav>
  );
}
