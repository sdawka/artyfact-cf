import { useState } from "react";
import type { Verdict } from "../../shared/api";
import styles from "./StylePage.module.css";

const VERDICTS: { verdict: Verdict; glyph: string }[] = [
  { verdict: "pass", glyph: "✓" },
  { verdict: "fail", glyph: "×" },
  { verdict: "unknown", glyph: "?" },
  { verdict: "stale", glyph: "↻" },
  { verdict: "not-run", glyph: "–" },
];

const TABS = ["Overview", "Map", "Work"];

/** Living style sheet for the whimsy theme, served at /style. */
export function StylePage() {
  const [tab, setTab] = useState("Map");
  return (
    <main className={styles.page}>
      <p className={`wordmark ${styles.wordmark}`}>
        artyfact
      </p>
      <h1 className={styles.title}>Style sheet</h1>
      <p>
        A System is what you are building and why. This page shows the pieces every view is made
        from, so they stay the same across the app. Display lettering is for the wordmark and page
        titles only; everything else uses the body face.
      </p>

      <h2>Bracket card</h2>
      <div
        className={`u-brackets ${styles.card}`}
        tabIndex={0}
      >
        Hover or focus this card to see the corner brackets.
      </div>

      <h2>Segmented tabs</h2>
      <div className="u-segments" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <h2>Marker link</h2>
      <p>
        Read the <a className="u-marker" href="/style">task packet</a> before you start work.
      </p>

      <h2>Verdicts</h2>
      <p className={styles.verdicts}>
        {VERDICTS.map(({ verdict, glyph }) => (
          <span key={verdict} className="u-verdict" data-verdict={verdict}>
            <span aria-hidden="true">{glyph}</span> {verdict}
          </span>
        ))}
      </p>
    </main>
  );
}
