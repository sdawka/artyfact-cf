import { useId, type ReactNode } from "react";
import { Count } from "../Count/Count";
import styles from "./Section.module.css";

export interface SectionProps {
  title: ReactNode;
  /** Default 2. Section titles use the UI face (`--type-h2` / `--type-h3`), never larger than the h1. */
  headingLevel?: 2 | 3;
  /** One quiet line under the title. */
  description?: ReactNode;
  /** Inventory count beside the title (tabular, shows 0). */
  count?: number | null;
  /** Buttons or links at the end of the title row. */
  actions?: ReactNode;
  /** `none` (default): space separates sections. `panel`: an opaque `--surface-panel` region. */
  surface?: "none" | "panel";
  id?: string;
  className?: string;
  children?: ReactNode;
}

/** A titled region of a view (`section` labelled by its heading). Sections are `--spacing-10` apart. */
export function Section({ title, headingLevel = 2, description, count, actions, surface = "none", id, className, children }: SectionProps) {
  const H = `h${headingLevel}` as const;
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={[styles.section, className].filter(Boolean).join(" ")} data-surface={surface} data-level={headingLevel}>
      <div className={styles.head}>
        <H id={headingId} className={styles.title}>
          {title}
          {count !== undefined && <> <Count n={count} /></>}
        </H>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {description && <p className={styles.description}>{description}</p>}
      {children}
    </section>
  );
}
