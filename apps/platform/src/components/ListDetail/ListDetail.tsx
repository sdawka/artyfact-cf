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
  /** In one-pane mode (under 900px, or ListDetail under 40rem) only one pane shows: the detail when something is selected, else the list. */
  hasSelection: boolean;
  /** Clears the selection (mobile back link). Required for the back link to render. */
  onBack?: () => void;
  /** Mobile back link text, e.g. "Back to queue". */
  backLabel?: string;
  /** `narrow` 20rem (default) or `wide` 24rem list pane. */
  listWidth?: "narrow" | "wide";
  className?: string;
}

/** Below this width of its own (40rem) ListDetail shows one pane, as it does on screens under 900px. Matches the CSS. */
export const TWO_PANE_MIN_PX = 640;
const ROOT = "data-list-detail";

/**
 * Whether ListDetail shows both panes: a viewport of at least 900px and, once one is on the page, a ListDetail at least
 * TWO_PANE_MIN_PX wide (an open Inspector can leave less). Views use it before opening a first item by themselves.
 * True where nothing is laid out (no matchMedia, as in unit tests).
 */
export function twoPanes(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  if (!window.matchMedia("(min-width: 900px)").matches) return false;
  const root = document.querySelector(`[${ROOT}]`);
  return !root || root.getBoundingClientRect().width >= TWO_PANE_MIN_PX;
}

/**
 * Workbench layout: a list pane (20–24rem, sticky, own scroll) beside a detail pane that fills the rest. Below 900px the
 * panes are two screens: the detail replaces the list and carries a back link. Never both stacked. The same happens
 * when ListDetail itself is narrower than 40rem (a container query), so an open Inspector never pushes it sideways.
 */
export function ListDetail({ list, detail, listLabel, detailLabel = "Detail", hasSelection, onBack, backLabel = "Back to list", listWidth = "narrow", className }: ListDetailProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(" ")} {...{ [ROOT]: "" }} data-selection={hasSelection ? "" : undefined} data-list-width={listWidth}>
      <div className={styles.layout}>
        <section className={styles.list} aria-label={listLabel}>{list}</section>
        <section className={styles.detail} aria-label={detailLabel}>
          {hasSelection && onBack && (
            <Button variant="ghost" size="compact" className={styles.back} onClick={onBack}><ArrowLeftIcon aria-hidden="true" />{backLabel}</Button>
          )}
          {detail}
        </section>
      </div>
    </div>
  );
}
