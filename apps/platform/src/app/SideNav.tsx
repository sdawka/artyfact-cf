import { NavLink } from "react-router";
import { VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useKeepParams } from "@/model/useSelection";
import styles from "./SideNav.module.css";

/** The seven views, in rail order. */
export const NAV_VIEWS: { view: ViewName; glyph: string }[] = [
  { view: "overview", glyph: "◎" },
  { view: "map", glyph: "▦" },
  { view: "journeys", glyph: "⇢" },
  { view: "theory", glyph: "△" },
  { view: "work", glyph: "⎇" },
  { view: "evaluations", glyph: "✓" },
  { view: "history", glyph: "↺" },
];

export function SideNav() {
  const href = useKeepParams();
  return (
    <nav className={`shell-nav ${styles.nav}`} aria-label="Views">
      <ul className={styles.list}>
        {NAV_VIEWS.map(({ view, glyph }) => (
          <li key={view}>
            <NavLink to={href(view)} className={`u-brackets ${styles.link}`} title={VIEW_LABELS[view]}>
              <span className={styles.glyph} aria-hidden="true">{glyph}</span>
              <span className={styles.label}>{VIEW_LABELS[view]}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
