import { NavLink } from "react-router";
import { useKindViews, VIEW_GLYPHS, VIEW_GROUPS, VIEW_KINDS, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useReviewCount } from "@/model/useReviewCount";
import { useKeepParams, useSystemRoute } from "@/model/useSelection";
import styles from "./SideNav.module.css";

/** Every view on the rail, in rail order (Overview, then Genome, Proteome, Phenome). */
export const NAV_VIEWS: { view: ViewName; glyph: string }[] = VIEW_GROUPS.flatMap((g) =>
  g.views.map((view) => ({ view, glyph: VIEW_GLYPHS[view] })),
);

function NavItem({ view, href, count = 0 }: { view: ViewName; href: string; count?: number }) {
  const label = VIEW_LABELS[view];
  return (
    <li>
      <NavLink
        to={href}
        className={`u-brackets ${styles.link}`}
        title={label}
        aria-label={count > 0 ? `${label}, ${count} waiting` : undefined}
      >
        <span className={styles.glyph} aria-hidden="true">{VIEW_GLYPHS[view]}</span>
        <span className={styles.label}>{label}</span>
        {count > 0 && <span className={styles.count} data-tone="attention">{count}</span>}
      </NavLink>
    </li>
  );
}

/** Overview, then one group per layer headed by its name with its question beneath. Every link keeps the global params. */
export function SideNav() {
  const href = useKeepParams();
  const { systemId, rev } = useSystemRoute();
  const views = useKindViews();
  const reviewCount = useReviewCount();
  // A view that needs a kind (Journeys, Theory) shows only when the System's templates declare it.
  const shown = (v: ViewName) => !VIEW_KINDS[v] || views.declares(VIEW_KINDS[v]);
  const item = (v: ViewName) => <NavItem key={v} view={v} href={href(v)} count={v === "review" ? reviewCount : 0} />;
  return (
    <nav className={`shell-nav ${styles.nav}`} aria-label="Views">
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
      <NavLink className={styles.link} to={`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/parts`} title="Private Parts"><span className={styles.glyph} aria-hidden="true">▧</span><span className={styles.label}>Private Parts</span></NavLink>
    </nav>
  );
}
