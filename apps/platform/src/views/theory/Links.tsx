import { useCallback, useEffect, useState, type RefObject } from "react";
import styles from "./Links.module.css";

export interface LinkSpec {
  id: string;
  /** `data-cell` value of the source cell; the curve leaves its right edge. */
  from: string;
  /** `data-cell` value of the target cell; the curve enters its left edge. */
  to: string;
}
interface Measured {
  id: string;
  d: string;
}

/** Cubic bezier from the right middle of `a` to the left middle of `b`, in container coordinates. */
export function bezier(a: DOMRect, b: DOMRect, origin: { left: number; top: number }): string {
  const x1 = a.right - origin.left;
  const y1 = a.top + a.height / 2 - origin.top;
  const x2 = b.left - origin.left;
  const y2 = b.top + b.height / 2 - origin.top;
  const dx = Math.max((x2 - x1) / 2, 12);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

/** SVG layer of curves between cells, measured from the DOM and re-measured when the grid resizes. */
export function Links({ containerRef, links }: { containerRef: RefObject<HTMLElement | null>; links: readonly LinkSpec[] }) {
  const [paths, setPaths] = useState<Measured[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const root = containerRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const cell = (key: string) => root.querySelector(`[data-cell="${key}"]`)?.getBoundingClientRect();
    setSize({ w: root.scrollWidth, h: root.scrollHeight });
    setPaths(
      links.flatMap((l) => {
        const a = cell(l.from);
        const b = cell(l.to);
        return a && b ? [{ id: l.id, d: bezier(a, b, { left: box.left - root.scrollLeft, top: box.top - root.scrollTop }) }] : [];
      }),
    );
  }, [containerRef, links]);

  // Not a layout effect: a child's layout effects run before the parent's ref is attached.
  useEffect(() => {
    measure();
    const root = containerRef.current;
    const ro = new ResizeObserver(measure);
    if (root) {
      ro.observe(root);
      root.querySelectorAll("[data-cell]").forEach((c) => ro.observe(c));
    }
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, measure]);

  return (
    <svg className={styles.links} width={size.w} height={size.h} aria-hidden="true" focusable="false">
      {paths.map((p) => (
        <path key={p.id} d={p.d} data-link={p.id} />
      ))}
    </svg>
  );
}
