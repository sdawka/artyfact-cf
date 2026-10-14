import { useId, type ReactNode, type Ref } from "react";
import { Link, useInRouterContext } from "react-router";
import { useScopeContext, type ScopeCrumb } from "./useScopeContext";
import styles from "./PageHeader.module.css";

export type PageHeaderVariant = "standard" | "system" | "compact";

export interface PageHeaderProps {
  /** The view's h1 (display face). `system`: the System name, set larger. */
  title: ReactNode;
  /** One sentence of purpose, ≤70ch. In `compact` it becomes the h1's accessible description instead of a visible line. */
  purpose?: ReactNode;
  /** Scope path above the h1 (inline beside it in `compact`). Default: `useScopeContext()` from the route; `null` hides it. */
  context?: ReactNode | null;
  /** The view's one primary action (`Button variant="primary"`). Turn it secondary while a Panel with its own primary is open. */
  primary?: ReactNode;
  /** Secondary actions, left of the primary. */
  secondary?: ReactNode;
  /** Up to three chips about the whole page. */
  status?: ReactNode;
  variant?: PageHeaderVariant;
  /** Default `view-title` (the focus target after navigation and panel close). */
  titleId?: string;
  titleRef?: Ref<HTMLHeadingElement>;
  /** Extra row under the header (a canvas toolbar in `compact`). */
  children?: ReactNode;
  className?: string;
}

/**
 * Every view's header: optional scope path, the h1 (`tabIndex=-1`, id `view-title`), purpose, actions and status.
 * Actions sit right of the h1 and wrap under the purpose on narrow screens, primary first.
 */
export function PageHeader({
  title, purpose, context, primary, secondary, status, variant = "standard", titleId = "view-title", titleRef, children, className,
}: PageHeaderProps) {
  const purposeId = useId();
  const compact = variant === "compact";
  const ctx = context === undefined ? <RouteScope /> : context;
  return (
    <header className={[styles.header, className].filter(Boolean).join(" ")} data-variant={variant}>
      {ctx && !compact && <div className={styles.context}>{ctx}</div>}
      <div className={styles.top}>
        <div className={styles.titleRow}>
          <h1 id={titleId} ref={titleRef} tabIndex={-1} className={styles.title} aria-describedby={compact && purpose ? purposeId : undefined}>{title}</h1>
          {ctx && compact && <div className={styles.context}>{ctx}</div>}
        </div>
        {(primary || secondary) && <div className={styles.actions}>{secondary}{primary}</div>}
      </div>
      {purpose && <p id={purposeId} className={compact ? "sr-only" : styles.purpose}>{purpose}</p>}
      {status && <div className={styles.status}>{status}</div>}
      {children && <div className={styles.extra}>{children}</div>}
    </header>
  );
}

function RouteScope() {
  if (!useInRouterContext()) return null;
  return <RouteScopeInner />;
}
function RouteScopeInner() {
  const crumbs = useScopeContext();
  return crumbs.length ? <ScopePath crumbs={crumbs} /> : null;
}

/** A scope path: plain links, the current item as text (`aria-current="page"`). Never marker pills. */
export function ScopePath({ crumbs, label = "Scope" }: { crumbs: ScopeCrumb[]; label?: string }) {
  return (
    <nav aria-label={label} className={styles.scope}>
      <ol>
        {crumbs.map((c, i) => (
          <li key={i}>
            {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
