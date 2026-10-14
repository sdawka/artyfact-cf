import type { ReactNode } from "react";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Button } from "../ui/Controls";
import styles from "./ListDetail.module.css";

export interface ListDetailProps {
  list: ReactNode;
  detail: ReactNode;
  /** Accessible name of the list pane ("Review queue"). */
  listLabel: string;
  /** Accessible name of the detail pane (default "Detail"). */
  detailLabel?: string;
  /** Below 900px only one pane shows: the detail when something is selected, else the list. */
  hasSelection: boolean;
  /** Clears the selection (mobile back link). Required for the back link to render. */
  onBack?: () => void;
  /** Mobile back link text, e.g. "Back to queue". */
  backLabel?: string;
  /** `narrow` 20rem (default) or `wide` 24rem list pane. */
  listWidth?: "narrow" | "wide";
  className?: string;
}

/**
 * Workbench layout: a list pane (20–24rem, sticky, own scroll) beside a detail pane that fills the rest. Below 900px the
 * panes are two screens: the detail replaces the list and carries a back link. Never both stacked.
 */
export function ListDetail({ list, detail, listLabel, detailLabel = "Detail", hasSelection, onBack, backLabel = "Back to list", listWidth = "narrow", className }: ListDetailProps) {
  return (
    <div className={[styles.layout, className].filter(Boolean).join(" ")} data-selection={hasSelection ? "" : undefined} data-list-width={listWidth}>
      <section className={styles.list} aria-label={listLabel}>{list}</section>
      <section className={styles.detail} aria-label={detailLabel}>
        {hasSelection && onBack && (
          <Button variant="ghost" size="compact" className={styles.back} onClick={onBack}><ArrowLeftIcon aria-hidden="true" />{backLabel}</Button>
        )}
        {detail}
      </section>
    </div>
  );
}
