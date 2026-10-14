import { Button } from "@/components/ui";
import { useState } from "react";
import { CopyText } from "../CopyText";
import { countdown, countdownTone, useNow } from "../lib";
import { Markdown } from "../Markdown";
import styles from "../work.module.css";

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
  const tone = countdownTone(expiresAt, now);
  return (
    <div className={styles.packet}>
      {cli !== undefined && (
        <section className={styles.startCommand} aria-label="Start command">
          <h3>Start command</h3>
          {cli === null ? (
            <p role="note">Command unavailable: the server did not return one. The token is not shown again.</p>
          ) : showCli ? (
            <>
              <p role="note">
                This command contains the write token and the realization secret. Neither is shown again, so copy it now.
              </p>
              <pre className={styles.commandWell}><code>{cli}</code></pre>
              <div className={styles.actions}>
                <CopyText value={cli} label="Copy command" variant="primary" />
                <Button type="button" variant="ghost" onClick={() => setHidden(true)}>I have copied it, hide</Button>
              </div>
            </>
          ) : (
            <p className={styles.muted}>Command hidden. The token is not shown again; start another realization to get a new one.</p>
          )}
          <p className={styles.tokenLine}>
            <span className={styles.token} data-tone={tone}>Token expires in <strong className="u-numeric" data-testid="token-countdown">{countdown(expiresAt, now)}</strong></span>
            {remote && <span>remote <code>{remote}</code></span>}
          </p>
        </section>
      )}
      <section aria-label="Task Packet" className={styles.packetBody}>
        <div className={styles.packetHead}>
          <h3>Task Packet</h3>
          <CopyText value={markdown} label="Copy packet" variant="ghost" />
        </div>
        <Markdown source={markdown} />
      </section>
    </div>
  );
}
