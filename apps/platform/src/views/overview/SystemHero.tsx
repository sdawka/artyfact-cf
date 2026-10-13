import { useRef } from "react";
import { SurfaceField, type SurfaceHandle, type SurfacePoint } from "@artyfact/effects";
import { useFx, type FxKind } from "@/effects/fx";
import { useSystemVitals } from "@/effects/vitals";
import { useModel } from "@/model/useModel";
import { ThreeStatesRow } from "./ThreeStatesRow";
import styles from "./Overview.module.css";

/** Pulse strength per event when the event carries none. `select` only sparks. */
const STRENGTH: Record<Exclude<FxKind, "select">, number> = { promoted: 1.6, submitted: 1, commit: 0.9, fail: 1.3 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The System's meaningful header owns its light. The three state meters remain separate. */
export function SystemHero() {
  const m = useModel();
  const vitals = useSystemVitals();
  const surface = useRef<SurfaceHandle>(null);
  const box = useRef<HTMLDivElement>(null);

  const pointTo = (x: number, y: number): SurfacePoint | undefined => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return undefined;
    return { x: Math.min(1, Math.max(0, (x - r.left) / r.width)), y: Math.min(1, Math.max(0, (y - r.top) / r.height)) };
  };
  const sparkToward = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    surface.current?.spark(pointTo(r.left + r.width / 2, r.top + r.height / 2));
  };
  useFx((d) => {
    const point = d.x !== undefined && d.y !== undefined ? pointTo(d.x, d.y) : undefined;
    if (d.kind === "select") surface.current?.spark(point);
    else surface.current?.pulse(d.strength ?? STRENGTH[d.kind], point);
  });

  const system = m.index.model.system;
  const purpose = [...m.index.model.purposes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))[0];
  const criteria = (m.index.model.criteria ?? []).filter((c) => c.ownerKind === "thing" && !c.deferred);
  const troubled = criteria.map((c) => m.verdictOf(c.id)).filter((v) => v === "fail" || v === "stale").length;
  const { measures, health } = vitals;
  const encoding = [
    `Readiness: ${Math.round(measures.readiness * 100)}%`,
    `Checks: ${plural(troubled, "failing or stale check")}`,
    `Work: ${plural(measures.active, "active Evolution")}`,
    `Blockers: ${plural(measures.blockers, "blocker")}`,
    `Colour: ${health}`,
  ].join(" · ");

  return (
    <section className={styles.hero} aria-labelledby="hero-title" data-health={health}>
      <div ref={box} className={styles.heroTop}>
        <SurfaceField ref={surface} {...vitals.surface} transition={0.6} />
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
            <span className={styles.encodingLead}>Light follows this System’s state.</span> {encoding}
          </p>
        </div>
      </div>
      <ThreeStatesRow onMeter={sparkToward} />
    </section>
  );
}
