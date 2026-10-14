import { useRef, type ReactNode } from "react";
import { SurfaceField, type SurfaceHandle, type SurfacePoint } from "@artyfact/effects";
import { useFx, type FxKind } from "@/effects/fx";
import { useSystemVitals } from "@/effects/vitals";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { useModel } from "@/model/useModel";
import styles from "./Overview.module.css";

/** Pulse strength per event when the event carries none. `select` only sparks. */
const STRENGTH: Record<Exclude<FxKind, "select">, number> = { promoted: 1.6, submitted: 1, commit: 0.9, fail: 1.3 };

/**
 * The System's one light (the only SurfaceField on the view). The page header (System h1 and Purpose) sits in the field's
 * clear upper-left; the light gathers along the bottom and right edges. What drives it, in plain words and labelled
 * values, sits on a solid band under the field, never over the haze.
 */
export function SystemHero({ children }: { children?: ReactNode }) {
  const m = useModel();
  const vitals = useSystemVitals();
  const surface = useRef<SurfaceHandle>(null);
  const box = useRef<HTMLDivElement>(null);

  const pointTo = (x: number, y: number): SurfacePoint | undefined => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return undefined;
    return { x: Math.min(1, Math.max(0, (x - r.left) / r.width)), y: Math.min(1, Math.max(0, (y - r.top) / r.height)) };
  };
  useFx((d) => {
    const point = d.x !== undefined && d.y !== undefined ? pointTo(d.x, d.y) : undefined;
    if (d.kind === "select") surface.current?.spark(point);
    else surface.current?.pulse(d.strength ?? STRENGTH[d.kind], point);
  });

  const criteria = (m.index.model.criteria ?? []).filter((c) => c.ownerKind === "thing" && !c.deferred);
  const troubled = criteria.map((c) => m.verdictOf(c.id)).filter((v) => v === "fail" || v === "stale").length;
  const { measures, health } = vitals;

  return (
    <section className={styles.hero} aria-label="System light" data-health={health}>
      <div ref={box} className={styles.heroField}>
        <SurfaceField ref={surface} {...vitals.surface} transition={0.6} />
        <div className={styles.heroHead}>{children}</div>
      </div>
      <div className={styles.heroFoot}>
        <p className={styles.heroLead}>The light reflects readiness, checks, active work and blockers.</p>
        <MetaLine
          items={[
            { label: "Readiness", value: `${Math.round(measures.readiness * 100)}%` },
            { label: "Failing or stale checks", value: troubled },
            { label: "Active Evolutions", value: measures.active },
            { label: "Blockers", value: measures.blockers },
            ...(health === "pending" ? [] : [{ label: "Light", value: health }]),
          ]}
        />
      </div>
    </section>
  );
}
