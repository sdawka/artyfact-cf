import { NavLink, useParams } from "react-router";
import { useKindViews, VIEW_GLYPHS, VIEW_GROUPS, VIEW_KINDS, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { thingPath, useKeepParams, useSystemRoute } from "@/model/useSelection";
import styles from "./SideNav.module.css";

/** Every view in rail order (Overview, then Genome, Proteome, Phenome). */
export const NAV_VIEWS: { view: ViewName; glyph: string }[] = VIEW_GROUPS.flatMap((g) =>
  g.views.map((view) => ({ view, glyph: VIEW_GLYPHS[view] })),
);

function NavItem({ view, href }: { view: ViewName; href: string }) {
  return (
    <li>
      <NavLink to={href} className={`u-brackets ${styles.link}`} title={VIEW_LABELS[view]}>
        <span className={styles.glyph} aria-hidden="true">{VIEW_GLYPHS[view]}</span>
        <span className={styles.label}>{VIEW_LABELS[view]}</span>
      </NavLink>
    </li>
  );
}

/** Overview, then one labelled group per layer. Every link keeps the global params. */
export function SideNav() {
  const href = useKeepParams();
  const { systemId, rev } = useSystemRoute();
  const { thingId } = useParams();
  const views = useKindViews();
  // A view that needs a kind (Journeys, Theory) shows only when the System's templates declare it.
  const shown = (v: ViewName) => !VIEW_KINDS[v] || views.declares(VIEW_KINDS[v]);
  return (
    <nav className={`shell-nav ${styles.nav}`} aria-label="Views">
      {thingId && <NavLink className={styles.link} to={thingPath(systemId, rev, thingId)} title="Thing workspace" end><span className={styles.glyph} aria-hidden="true">◉</span><span className={styles.label}>Thing workspace</span></NavLink>}
      {VIEW_GROUPS.map((g) =>
        g.label === null ? (
          <ul key="top" className={styles.list}>
            {g.views.filter(shown).map((v) => <NavItem key={v} view={v} href={href(v)} />)}
          </ul>
        ) : (
          <div key={g.label} role="group" aria-labelledby={`nav-group-${g.label}`} className={styles.group}>
            <p id={`nav-group-${g.label}`} className={styles.groupHead}>{g.label}</p>
            <ul className={styles.list}>
              {g.views.filter(shown).map((v) => <NavItem key={v} view={v} href={href(v)} />)}
            </ul>
          </div>
        ),
      )}
      <NavLink className={styles.link} to={`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/parts`} title="Private Parts"><span className={styles.glyph} aria-hidden="true">▧</span><span className={styles.label}>Private Parts</span></NavLink>
    </nav>
  );
}
