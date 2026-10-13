import { Link } from "react-router";
import { Card } from "@/components/Card/Card";
import { shortRev } from "@/model/revisions";
import { relTime } from "@/model/time";
import { cardSummary, type CardSummary } from "./signifiers";
import styles from "./home.module.css";

/**
 * One System on Home: the System entry selects its sole Thing when there is one, else opens the System overview.
 * "Describe a change" and "Review" sit beside the card link (a linked card holds no other interactive content).
 */
export function SystemCard({ system, now }: { system: CardSummary; now: number }) {
  const { headline, tone, deploy, reviewHref } = cardSummary(system);
  const updated = system.updatedAt ? relTime(system.updatedAt, now) : "unknown";
  const base = `/s/${encodeURIComponent(system.systemId)}`;
  return (
    <li className={styles.cardItem}>
      <Card as="div" to={base} title={system.title || system.systemId} headingLevel={2} state={tone === "quiet" ? undefined : tone}>
        <p className={styles.meta}>
          <code>{system.systemId}</code>
          <span>Phase: {system.phase ?? "unknown"}</span>
        </p>
        <p className={styles.headline} data-tone={tone}>{headline}</p>
        <p className={styles.deploy}>
          <span data-status={deploy.status} data-tone={deploy.tone} title={deploy.title}>
            {deploy.glyph && <span aria-hidden="true">{deploy.glyph} </span>}
            {deploy.label}
          </span>
          {deploy.build && (
            <>
              {" · "}
              <span data-status={deploy.build.status} data-tone={deploy.build.tone} title={deploy.build.title}>{deploy.build.label}</span>
            </>
          )}
        </p>
        <p className={styles.footer}>
          <span>head <code>{system.head ? shortRev(system.head) : "unknown"}</code></span>
          <span>updated {updated}</span>
        </p>
      </Card>
      <div className={styles.cardActions}>
        <Link className={`u-marker ${styles.cardAction}`} to={`${base}/r/head/work?panel=intent`}>Describe a change</Link>
        {reviewHref && <Link className={`u-marker ${styles.cardAction}`} to={reviewHref}>Review</Link>}
      </div>
    </li>
  );
}
