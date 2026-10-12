import type { FileScope } from "../../../shared/api";
import { useCompareFile } from "@/api/queries";
import { LineDiff } from "@/components/LineDiff/LineDiff";
import { shortSha } from "@/model/time";
import styles from "./compare.module.css";

/** One file on both sides as a line diff; a missing side means the file was added or removed. */
export function FileDiff({ repo, from, to, path }: { repo: FileScope; from: string; to: string; path: string }) {
  const q = useCompareFile({ repo, from, to, path });
  if (q.isLoading) return <p role="status">Loading {path}…</p>;
  if (q.isError || !q.data) return <p role="alert" className={styles.error}>Could not load {path} on both sides.</p>;
  const f = q.data;
  const state = f.from.hash === null ? "added" : f.to.hash === null ? "removed" : "modified";
  return (
    <section className={styles.fileDiff} aria-label={`Diff of ${path}`}>
      <h3 className={styles.fileHead}>
        <code>{path}</code> <span className={styles.muted}>{repo} · {state} · {shortSha(f.from.commit)} → {shortSha(f.to.commit)}</span>
      </h3>
      {f.binary ? (
        <p className={styles.muted}>Binary file: no line diff ({f.from.size} → {f.to.size} bytes).</p>
      ) : (
        <>
          {f.truncated && <p className={styles.muted}>The file is too large to show in full; the diff covers the loaded part only.</p>}
          <LineDiff from={f.from.text} to={f.to.text} label={path} />
        </>
      )}
    </section>
  );
}
