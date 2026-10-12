import type { ElementType, ReactNode } from "react";
import { Link } from "react-router";
import styles from "./Card.module.css";

/** `attention` = apricot border (needs a person); `unbuilt` = dashed border; other strings are free-form hooks for CSS. */
export type CardState = "attention" | "unbuilt" | "evolving" | (string & {});

interface CardBase {
  /** Outer element; default `section`. Use `article` for list items, `li` directly inside a `ul`. */
  as?: ElementType;
  title?: ReactNode;
  /** Level of the title heading; default 2. */
  headingLevel?: 2 | 3 | 4;
  state?: CardState;
  className?: string;
  children?: ReactNode;
}

interface StaticCard extends CardBase {
  /** Buttons/links beside the title. Not allowed on a linked card (no nested interactive content). */
  actions?: ReactNode;
  to?: undefined;
}

interface LinkedCard extends CardBase {
  /** Makes the whole card one link (`u-brackets` on hover/focus). */
  to: string;
  actions?: undefined;
}

export type CardProps = StaticCard | LinkedCard;

/**
 * Opaque surface with a subtle border, radius md and no shadow. Never nest a Card in a Card.
 * `state` sets `data-state`; `to` turns the whole surface into a single link.
 */
export function Card({ as: Tag = "section", title, headingLevel = 2, actions, state, to, className, children }: CardProps) {
  const H = `h${headingLevel}` as const;
  const head = (title || actions) && (
    <div className={styles.head}>
      {title && <H className={styles.title}>{title}</H>}
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
  if (to !== undefined) {
    return (
      <Tag className={`${styles.wrap} ${className ?? ""}`}>
        <Link to={to} className={`u-brackets ${styles.card} ${styles.link}`} data-state={state}>
          {head}
          {children}
        </Link>
      </Tag>
    );
  }
  return (
    <Tag className={`${styles.card} ${className ?? ""}`} data-state={state}>
      {head}
      {children}
    </Tag>
  );
}
