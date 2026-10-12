import { NavLink } from "react-router";
import { VIEW_GLYPHS, VIEW_GROUPS, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useKeepParams } from "@/model/useSelection";
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
  return (
    <nav className={`shell-nav ${styles.nav}`} aria-label="Views">
      {VIEW_GROUPS.map((g) =>
        g.label === null ? (
          <ul key="top" className={styles.list}>
            {g.views.map((v) => <NavItem key={v} view={v} href={href(v)} />)}
          </ul>
        ) : (
          <div key={g.label} role="group" aria-labelledby={`nav-group-${g.label}`} className={styles.group}>
            <p id={`nav-group-${g.label}`} className={styles.groupHead}>{g.label}</p>
            <ul className={styles.list}>
              {g.views.map((v) => <NavItem key={v} view={v} href={href(v)} />)}
            </ul>
          </div>
        ),
      )}
    </nav>
  );
}
