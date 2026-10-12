import { useRef, useState } from "react";
import {
  AmbientField, EffectsProvider, Orb, ORB_PRESET_NAMES, type AmbientFieldHandle, type OrbHandle, type OrbPresetName,
} from "@artyfact/effects";
import type { UiVerdict as Verdict } from "@/model/status";
import styles from "./StylePage.module.css";

const VERDICTS: { verdict: Verdict; glyph: string }[] = [
  { verdict: "pass", glyph: "✓" },
  { verdict: "fail", glyph: "×" },
  { verdict: "unknown", glyph: "?" },
  { verdict: "stale", glyph: "↻" },
  { verdict: "not-run", glyph: "–" },
];

const TABS = ["Overview", "Map", "Work"];

const PRESET_USE: Record<OrbPresetName, string> = {
  apricot: "Accent. Default, neutral or in progress.",
  verdant: "Success. Every gate passes.",
  ember: "Error. Failing or blocked.",
  tide: "Info. Waiting on evidence.",
  dusk: "Background hue. Idle or ambient.",
};

function OrbTile({ preset }: { preset: OrbPresetName }) {
  const orb = useRef<OrbHandle>(null);
  return (
    <figure className={styles.orbTile} data-preset={preset}>
      <div className={styles.orbBox}>
        <Orb ref={orb} preset={preset} particleCount={9000} />
      </div>
      <figcaption>
        <code>{preset}</code> <span className={styles.muted}>{PRESET_USE[preset]}</span>
      </figcaption>
      <button type="button" className={`u-brackets ${styles.smallButton}`} onClick={() => orb.current?.pulse(1)}>
        Pulse<span className="sr-only"> {preset}</span>
      </button>
    </figure>
  );
}

function EffectsSection() {
  const [enabled, setEnabled] = useState(true);
  const [intensity, setIntensity] = useState(0.5);
  const field = useRef<AmbientFieldHandle>(null);
  return (
    <EffectsProvider enabled={enabled}>
      <h2>Signature effects</h2>
      <p>
        Glow and haze mark signature moments, state changes and selection. They are decorative, follow reduced motion,
        and the page reads the same with them off.
      </p>
      <label className={styles.toggle}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Effects on
      </label>
      <div className={styles.orbGrid}>
        {ORB_PRESET_NAMES.map((p) => <OrbTile key={p} preset={p} />)}
      </div>

      <h3>Ambient field</h3>
      <div
        className={styles.ambientPanel}
        data-testid="ambient-panel"
        onPointerDown={(e) => field.current?.pulse(e.clientX, e.clientY, 1)}
      >
        <AmbientField ref={field} intensity={intensity} density={0.5} />
        <p className={styles.ambientText}>Click inside the panel to send a ripple.</p>
      </div>
      <label className={styles.toggle}>
        Intensity{" "}
        <input type="range" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
      </label>

      <h3>Glow tokens</h3>
      <p className={styles.glows}>
        <span className={styles.glow} data-glow="accent">accent</span>
        <span className={styles.glow} data-glow="success">success</span>
        <span className={styles.glow} data-glow="error">error</span>
      </p>
    </EffectsProvider>
  );
}

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

      <EffectsSection />
    </main>
  );
}
