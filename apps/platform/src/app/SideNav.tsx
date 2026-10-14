import { ArchiveIcon, ArrowRightIcon, CheckCircledIcon, CodeIcon, CommitIcon, CounterClockwiseClockIcon, DashboardIcon, GlobeIcon, MixIcon, ReaderIcon, RocketIcon, TargetIcon } from "@radix-ui/react-icons";
import { Link, NavLink, useParams, useSearchParams } from "react-router";
import { Count } from "@/components/Count/Count";
import { useModel } from "@/model/useModel";
import { GO_KEYS, useKindViews, VIEW_GLYPHS, VIEW_GROUPS, VIEW_KINDS, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useReviewCount } from "@/model/useReviewCount";
import { useWorkCount } from "@/model/useWorkCount";
import { useKeepParams, useSystemRoute, viewPath } from "@/model/useSelection";
import styles from "./SideNav.module.css";

const NAV_ICONS: Record<ViewName, typeof GlobeIcon> = {
  map: GlobeIcon, overview: DashboardIcon, journeys: ArrowRightIcon, theory: ReaderIcon,
  code: CodeIcon, work: CommitIcon, review: CheckCircledIcon, evaluations: TargetIcon,
  changelog: CounterClockwiseClockIcon, compare: MixIcon, phenome: RocketIcon,
};

/** Every view on the rail, in rail order (Overview, then Genome, Proteome, Phenome). */
export const NAV_VIEWS: { view: ViewName; glyph: string }[] = VIEW_GROUPS.flatMap((g) =>
  g.views.map((view) => ({ view, glyph: VIEW_GLYPHS[view] })),
);

/** The word after a rail count, for the link's accessible name ("Work, 2 ready for an agent"). */
const COUNT_WORDS: Partial<Record<ViewName, string>> = { review: "waiting", work: "ready for an agent" };

function NavItem({ view, href, count = 0 }: { view: ViewName; href: string; count?: number }) {
  const label = VIEW_LABELS[view];
  const Icon = NAV_ICONS[view];
  const goKey = Object.entries(GO_KEYS).find(([, v]) => v === view)?.[0];
  return (
    <li>
      <NavLink
        to={href}
        className={`u-selectable ${styles.link}`}
        title={goKey ? `${label} (G then ${goKey.toUpperCase()})` : label}
        aria-label={count > 0 ? `${label}, ${count} ${COUNT_WORDS[view] ?? "waiting"}` : undefined}
      >
        <span className={styles.glyph} aria-hidden="true"><Icon /></span>
        <span className={styles.label}>{label}</span>
        <Count n={count} tone="attention" />
      </NavLink>
    </li>
  );
}

/** Inside a Thing every rail link resolves to the Thing; this row says so and offers the way back to System depth. */
function ThingScope() {
  const { thingId } = useParams();
  const { systemId, rev, view } = useSystemRoute();
  const { bundle } = useModel();
  const [params] = useSearchParams();
  const thing = thingId ? bundle.model.things.find((t) => t.id === thingId) : undefined;
  if (!thing) return null;
  const qs = params.toString();
  const leave = `${viewPath(systemId, rev, view ?? "overview")}${qs ? `?${qs}` : ""}`;
  return (
    <div className={styles.scope} data-testid="thing-scope">
      <span className={styles.scopeName}>In {thing.name || thing.id}</span>
      <Link to={leave} className={styles.leave}>Leave</Link>
    </div>
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
      <ThingScope />
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
      <div className={styles.partsRow}>
        <NavLink className={`u-selectable ${styles.link}`} to={`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/parts`} title="Private Parts"><span className={styles.glyph} aria-hidden="true"><ArchiveIcon /></span><span className={styles.label}>Private Parts</span></NavLink>
      </div>
    </nav>
  );
}
