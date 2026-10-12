import type { SemanticChange } from "@artyfact/semantic";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModel } from "@/model/useModel";
import type { DeltaReview } from "../../../../../shared/api";
import styles from "../AmendmentReview.module.css";
import { CHANGE_CLASSES, SPECIFICITY_LEVELS, commitmentStatement, fmt, signalBand } from "./helpers";

type Tone = "pass" | "fail" | "review" | "subtle";

/** Tone for a harmful signal (contradicts, weakens): red at >= 0.9, attention at >= 0.5, else quiet. Never green. */
function harmTone(p: number | null | undefined): Tone {
  const b = signalBand(p);
  return b === "pass" ? "fail" : b === "review" ? "review" : "subtle";
}
const harmWord = (p: number | null | undefined) => {
  const b = signalBand(p);
  return b === "pass" ? "likely" : b === "review" ? "possible" : b === "fail" ? "unlikely" : "unclear";
};

function Provider({ review }: { review: DeltaReview }) {
  const { provider, model, ms } = review.provenance;
  if (provider === "fake") {
    return <p className={styles.provider} data-provider="fake">fake provider: canned answers, not a real model judgment ({model})</p>;
  }
  if (provider === "off") return <p className={styles.provider} data-provider="off">System One off — unknown</p>;
  if (provider === "error") {
    return (
      <p className={styles.provider} data-provider="error">
        System One call failed — unknown{review.provenance.error ? ` (${review.provenance.error.message})` : ""}
      </p>
    );
  }
  return <p className={styles.provider}>{provider} · {model} · {ms} ms</p>;
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.confidence}>
      <span className={styles.muted}>confidence {fmt(value)}</span>
      <div
        className={styles.meter}
        role="meter"
        aria-label={`${label} ${fmt(value)}`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
      >
        <div className={styles.meterFill} style={{ inlineSize: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

function ChangeClass({ review }: { review: DeltaReview }) {
  const cc = review.changeClass;
  if (!cc) return <p className={styles.muted}>Change class: unknown</p>;
  const top = cc.outcome;
  const topP = cc.probabilities[top] ?? 0;
  const topBand = signalBand(topP);
  return (
    <div>
      <h5 className={styles.signalHead}>Change class</h5>
      <ul className={styles.classes}>
        {CHANGE_CLASSES.map((c) => {
          const isTop = c.id === top;
          const p = cc.probabilities[c.id];
          const confident = isTop && topBand === "pass";
          const tone: Tone = confident ? (c.id === "hard-rule-violation" ? "fail" : c.benign ? "pass" : "review") : "subtle";
          return (
            <li key={c.id} className={styles.classRow} data-tone={tone} {...(confident && { "data-top": "true" })}>
              <span>{c.label}</span>
              <span className={styles.num}>{fmt(p)}</span>
              {isTop && !confident && <span className={styles.tag}>review</span>}
            </li>
          );
        })}
      </ul>
      <Meter label="Confidence" value={cc.confidence} />
    </div>
  );
}

function Contradicts({ review, commitments }: { review: DeltaReview; commitments: Parameters<typeof commitmentStatement>[1] }) {
  const m = useModel();
  const entries = Object.entries(review.contradicts);
  return (
    <div>
      <h5 className={styles.signalHead}>Contradicts a commitment</h5>
      {entries.length ? (
        <ul className={styles.signalList}>
          {entries.map(([id, p]) => (
            <li key={id} className={styles.signalRow} data-tone={harmTone(p)}>
              <span>{commitmentStatement(id, commitments, m.byId(id)?.item)}</span>
              <span className={styles.num}>{fmt(p)}</span>
              <span className={styles.tag}>{harmWord(p)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>unknown</p>
      )}
    </div>
  );
}

function Scalar({ label, p, tone, word }: { label: string; p: number | null; tone: Tone; word: string }) {
  return (
    <li className={styles.signalRow} data-tone={tone}>
      <span>{label}</span>
      <span className={styles.num}>{fmt(p)}</span>
      <span className={styles.tag}>{word}</span>
    </li>
  );
}

/** Deliberate non-standard choice at >= 0.9, with nothing else strongly flagged and no hard finding added. */
export function isCalmChoice(review: DeltaReview | undefined, hardAdded: number): boolean {
  const cc = review?.changeClass;
  if (!review || !cc || hardAdded > 0) return false;
  if (cc.outcome !== "deliberate-nonstandard-choice" || signalBand(cc.probabilities[cc.outcome]) !== "pass") return false;
  const harmful = [...Object.values(review.contradicts), review.weakens, cc.probabilities["hard-rule-violation"]];
  return harmful.every((p) => signalBand(p) !== "pass" && signalBand(p) !== "review");
}

/** True when the model flagged a hard-rule violation at >= 0.9 for this change. */
export const isHardFlag = (r: DeltaReview | undefined) => signalBand(r?.changeClass?.probabilities["hard-rule-violation"]) === "pass";

function OneChange({ change, review, hardAdded, commitments }: { change: SemanticChange; review: DeltaReview | undefined; hardAdded: number; commitments: Parameters<typeof commitmentStatement>[1] }) {
  if (!review) {
    return (
      <li className={styles.signalBlock}>
        <NodeChip id={change.id} kind={change.kind} size="sm" />
        <p className={styles.muted}>No System One judgment for this node: unknown.</p>
      </li>
    );
  }
  const spec = review.specificity;
  const consent = review.touchesConsent;
  return (
    <li className={styles.signalBlock}>
      <div className={styles.changeHead}>
        <NodeChip id={change.id} kind={change.kind} size="sm" />
      </div>
      <Provider review={review} />
      {isHardFlag(review) && (
        <p className={styles.flag} data-tone="fail">
          <span aria-hidden="true">× </span>Hard rule violation: model flagged; admin decides.
        </p>
      )}
      {isCalmChoice(review, hardAdded) && (
        <p className={styles.calm} data-calm="true">deliberate choice — no rule violated</p>
      )}
      <ChangeClass review={review} />
      <Contradicts review={review} commitments={commitments} />
      <ul className={styles.signalList}>
        <Scalar label="Weakens a commitment" p={review.weakens} tone={harmTone(review.weakens)} word={harmWord(review.weakens)} />
        <Scalar
          label="Touches consent"
          p={consent}
          tone={signalBand(consent) === "unknown" || signalBand(consent) === "fail" ? "subtle" : "review"}
          word={signalBand(consent) === "pass" ? "likely" : signalBand(consent) === "review" ? "possible" : "unlikely"}
        />
      </ul>
      <div className={styles.signalRow} data-tone="subtle">
        <span>Specificity</span>
        {spec ? (
          <>
            <span className={styles.num}>{spec.score} of 3</span>
            <span className={styles.muted}>{SPECIFICITY_LEVELS[spec.score] ?? "unknown level"}</span>
          </>
        ) : (
          <span className={styles.muted}>unknown</span>
        )}
      </div>
    </li>
  );
}

/** System One judgments per changed node. The model proposes; nothing below 0.9 is ever green. */
export function Signals({ changes, review, hardAdded, commitments }: { changes: SemanticChange[]; review: DeltaReview[]; hardAdded: number; commitments: Parameters<typeof commitmentStatement>[1] }) {
  if (!changes.length) return <p className={styles.muted}>No changes to judge.</p>;
  return (
    <ul className={styles.signalBlocks}>
      {changes.map((c) => (
        <OneChange key={c.id} change={c} review={review.find((r) => r.id === c.id)} hardAdded={hardAdded} commitments={commitments} />
      ))}
    </ul>
  );
}
