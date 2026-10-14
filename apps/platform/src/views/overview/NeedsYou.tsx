import { useReadiness } from "@/api/queries";
import { Count } from "@/components/Count/Count";
import { RowList, Row } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { useModel } from "@/model/useModel";
import { useReviewCount } from "@/model/useReviewCount";
import { useKeepParams } from "@/model/useSelection";
import { isBlocking } from "../../../shared/verdict";
import { BLOCKERS_ID } from "./BlockersList";
import styles from "./Overview.module.css";

/** What waits on a person: decisions in Review and blocking findings, each with its destination word (as on Home). Hidden when nothing waits. */
export function NeedsYou() {
  const m = useModel();
  const href = useKeepParams();
  const { data } = useReadiness();
  const waiting = useReviewCount();
  const blocking = (data ?? m.bundle.readiness).modelReadiness.findings.filter(isBlocking).length;
  if (waiting === 0 && blocking === 0) return null;
  const jump = () => {
    document.getElementById(BLOCKERS_ID)?.scrollIntoView({ block: "start" });
  };
  return (
    <Section title="Needs you">
      <RowList label="Needs you">
        {waiting > 0 && (
          <Row
            to={href("review")}
            tone="attention"
            title={<><Count n={waiting} tone="attention" /> {waiting === 1 ? "decision awaits" : "decisions await"} your review</>}
            status={<span className={styles.destination}>Review ›</span>}
          />
        )}
        {blocking > 0 && (
          <Row
            onSelect={jump}
            tone="fail"
            title={<><Count n={blocking} /> {blocking === 1 ? "finding blocks" : "findings block"} this System</>}
            status={<span className={styles.destination}>Blockers ›</span>}
          />
        )}
      </RowList>
    </Section>
  );
}
