import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeftIcon } from "@radix-ui/react-icons";
import { Button } from "../ui/Controls";
import styles from "./Panel.module.css";

export interface PanelProps {
  title: ReactNode;
  /** Default 2. */
  headingLevel?: 2 | 3;
  /** The panel's own primary; while it is open the PageHeader's primary turns secondary. */
  primary?: ReactNode;
  secondary?: ReactNode;
  /** Close: renders "Back to {region}" and, on unmount, returns focus to the control that opened the panel. */
  onBack?: () => void;
  /** Default "Back". Name the region it returns to: "Back to Work", "Back to files". */
  backLabel?: string;
  /** Move focus to the panel heading when it opens (default true). */
  autoFocus?: boolean;
  id?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * The container that **replaces** the region it is about (intent, new Evolution, promote, commit), never stacked above
 * it. Own h2, own primary, "Back to {region}". Focus moves to the h2 on open and back to the opener on close.
 */
export function Panel({ title, headingLevel = 2, primary, secondary, onBack, backLabel = "Back", autoFocus = true, id, className, children }: PanelProps) {
  const H = `h${headingLevel}` as const;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const el = heading.current;
    if (autoFocus) el?.focus();
    return () => {
      // Back to the opener when it is still on the page; otherwise the view title. A panel that is still mounted
      // (StrictMode re-runs effects) keeps focus.
      requestAnimationFrame(() => {
        if (el?.isConnected) return;
        if (opener?.isConnected) opener.focus();
        else document.getElementById("view-title")?.focus();
      });
    };
  }, [autoFocus]);
  return (
    <section id={id} aria-labelledby={headingId} className={[styles.panel, className].filter(Boolean).join(" ")}>
      {onBack && (
        <Button variant="ghost" size="compact" className={styles.back} onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" />{backLabel}
        </Button>
      )}
      <div className={styles.head}>
        <H id={headingId} ref={heading} tabIndex={-1} className={styles.title}>{title}</H>
        {(primary || secondary) && <div className={styles.actions}>{secondary}{primary}</div>}
      </div>
      {children}
    </section>
  );
}
