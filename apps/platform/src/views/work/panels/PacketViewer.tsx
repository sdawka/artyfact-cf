import { useEffect, useState } from "react";
import { countdown, useNow } from "../lib";
import { Markdown } from "../Markdown";
import styles from "../work.module.css";

/** Copy button whose accessible name does not repeat the (possibly secret, possibly huge) value. */
function CopyText({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);
  const copy = () => {
    const w = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error("clipboard unavailable"));
    w.then(() => setState("copied"), () => setState("failed"));
  };
  return (
    <>
      <button type="button" className={`u-brackets ${styles.btn}`} onClick={copy} aria-label={label}>
        {state === "idle" ? label : state === "copied" ? "Copied" : "Copy failed"}
      </button>
      <span className="sr-only" role="status">{state === "idle" ? "" : state === "copied" ? "Copied" : "Copy failed"}</span>
    </>
  );
}

export interface PacketViewerProps {
  markdown: string;
  /** The one-line command including the write token, shown once. `null`: the server sent none. */
  cli?: string | null | undefined;
  /** `realization.workspace.tokenExpiresAt`. */
  expiresAt?: string | undefined;
  remote?: string | undefined;
}

/** Task Packet (rendered markdown, copyable), the one-time CLI line and the token-expiry countdown. */
export function PacketViewer({ markdown, cli, expiresAt, remote }: PacketViewerProps) {
  const now = useNow(1000);
  const [hidden, setHidden] = useState(false);
  const showCli = !!cli && !hidden;
  return (
    <div className={styles.packet}>
      {cli !== undefined && (
        <section className={styles.cli} aria-label="Start command">
          <h3>Start command</h3>
          {cli === null ? (
            <p className={styles.warn} role="note">Command unavailable: the server did not return one. The token is not shown again.</p>
          ) : showCli ? (
            <>
              <p className={styles.warn} role="note">
                This command contains the write token. The token is not shown again, so copy it now.
              </p>
              <pre className={styles.cliLine}><code>{cli}</code></pre>
              <div className={styles.actions}>
                <CopyText value={cli} label="Copy command" />
                <button type="button" className={`u-brackets ${styles.btn}`} onClick={() => setHidden(true)}>I have copied it, hide</button>
              </div>
            </>
          ) : (
            <p className={styles.muted}>Command hidden. The token is not shown again; start another realization to get a new one.</p>
          )}
          <p>
            Token expires in <strong data-testid="token-countdown">{countdown(expiresAt, now)}</strong>
            {remote && <> · remote <code>{remote}</code></>}
          </p>
        </section>
      )}
      <section aria-label="Task Packet">
        <div className={styles.rhead}>
          <h3>Task Packet</h3>
          <CopyText value={markdown} label="Copy packet" />
        </div>
        <Markdown source={markdown} />
      </section>
    </div>
  );
}
