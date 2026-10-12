import { useRef } from "react";
import { Orb, type OrbHandle } from "@artyfact/effects";
import { useFx, type FxKind } from "@/effects/fx";
import { useSystemVitals } from "@/effects/vitals";
import { useModel } from "@/model/useModel";
import { ThreeStatesRow } from "./ThreeStatesRow";
import styles from "./Overview.module.css";

/** Pulse strength per event when the event carries none. `select` only sparks. */
const STRENGTH: Record<Exclude<FxKind, "select">, number> = { promoted: 1.6, submitted: 1, commit: 0.9, fail: 1.3 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Overview's signature moment: the System's orb, drawn from live data (see `effects/vitals.ts`), beside its name and
 * primary Purpose, above the three separate state meters. Hovering or focusing a meter sparks the orb toward it; `artyfact:fx`
 * events (promotions, submissions, commits, failures) pulse it. The orb is decorative; the caption says what drives it.
 */
export function SystemHero() {
  const m = useModel();
  const vitals = useSystemVitals();
  const orb = useRef<OrbHandle>(null);
  const box = useRef<HTMLDivElement>(null);

  /** Radians from the orb's centre to a viewport point (0 = right, π/2 = up), or undefined before layout. */
  const angleTo = (x: number, y: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width) return undefined;
    return Math.atan2(r.top + r.height / 2 - y, x - (r.left + r.width / 2));
  };
  const sparkToward = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    orb.current?.spark(angleTo(r.left + r.width / 2, r.top + r.height / 2));
  };
  useFx((d) => {
    const angle = d.x !== undefined && d.y !== undefined ? angleTo(d.x, d.y) : undefined;
    if (d.kind === "select") orb.current?.spark(angle);
    else orb.current?.pulse(d.strength ?? STRENGTH[d.kind], angle);
  });

  const system = m.index.model.system;
  const purpose = [...m.index.model.purposes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))[0];
  const criteria = (m.index.model.criteria ?? []).filter((c) => c.ownerKind === "thing" && !c.deferred);
  const troubled = criteria.map((c) => m.verdictOf(c.id)).filter((v) => v === "fail" || v === "stale").length;
  const { measures, health } = vitals;
  const encoding = [
    `Fill: readiness ${Math.round(measures.readiness * 100)}%`,
    `Crackle: ${plural(troubled, "failing or stale check")}`,
    `Strands: ${plural(measures.active, "active Evolution")}`,
    `Flares: ${plural(measures.blockers, "blocker")}`,
    `Colour: ${health}`,
  ].join(" · ");

  return (
    <section className={styles.hero} aria-labelledby="hero-title" data-health={health}>
      <div className={styles.heroTop}>
        <div ref={box} className={styles.heroOrb} aria-hidden="true">
          <Orb ref={orb} {...vitals.orb} size={0.86} transition={1.2} />
        </div>
        <div className={styles.heroText}>
          <h2 id="hero-title" className={styles.systemName}>{system.name}</h2>
          {purpose ? (
            <p className={styles.heroPurpose}>
              <span className={styles.purposeId}>{purpose.id}</span> {purpose.statement}
            </p>
          ) : (
            <p className={styles.muted}>This System declares no Purpose.</p>
          )}
          <p className={styles.encoding}>
            <span className={styles.encodingLead}>The orb is live data.</span> {encoding}
          </p>
        </div>
      </div>
      <ThreeStatesRow onMeter={sparkToward} />
    </section>
  );
}
