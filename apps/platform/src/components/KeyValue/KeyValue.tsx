import type { ReactNode } from "react";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { useModelOptional } from "@/model/useModel";
import styles from "./KeyValue.module.css";

export interface KeyValueProps {
  data: Record<string, unknown> | [string, unknown][];
  /** Keys to leave out. Empty arrays, empty objects and undefined values are always left out. */
  omit?: string[];
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/** Definition list dump of an object. Strings that are model ids render as NodeChips. */
export function KeyValue({ data, omit = [] }: KeyValueProps) {
  const model = useModelOptional();
  const rows = (Array.isArray(data) ? data : Object.entries(data)).filter(([k, v]) => !omit.includes(k) && !isEmpty(v));
  const render = (v: unknown): ReactNode => {
    if (typeof v === "string") return model?.byId(v) ? <NodeChip id={v} size="sm" /> : v;
    if (typeof v === "number" || typeof v === "boolean") return <code>{String(v)}</code>;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return (
        <ul className={styles.list}>
          {v.map((x, i) => <li key={`${i}-${x}`}>{render(x)}</li>)}
        </ul>
      );
    }
    return <pre className={styles.pre}>{JSON.stringify(v, null, 2)}</pre>;
  };
  return (
    <dl className={styles.kv}>
      {rows.map(([k, v]) => (
        <div key={k} className={styles.row}>
          <dt className={styles.key}>{humanize(k)}</dt>
          <dd className={styles.value}>{render(v)}</dd>
        </div>
      ))}
    </dl>
  );
}
