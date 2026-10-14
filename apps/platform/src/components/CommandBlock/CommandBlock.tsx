import type { ReactNode } from "react";
import { CopyButton } from "../CopyButton/CopyButton";
import styles from "./CommandBlock.module.css";

export { styles as commandStyles };

export interface CommandBlockProps {
  /** Heading for the block (h3). */
  title?: ReactNode;
  /** One command per entry, each its own pasteable line. */
  commands: string[];
  /** Text before the commands. */
  children?: ReactNode;
  /** Show a Copy button for all commands (default true). */
  copy?: boolean;
  copyLabel?: string;
}

/** Commands a person pastes into a terminal, in the code face, with one Copy for all of them. */
export function CommandBlock({ title, commands, children, copy = true, copyLabel }: CommandBlockProps) {
  return (
    <div className={styles.block}>
      {(title || copy) && <div className={styles.head}>{title && <h3>{title}</h3>}{copy && <CopyButton value={commands.join("\n")} label={copyLabel} />}</div>}
      {children}
      {commands.map((c, i) => <pre key={i} className={styles.line}><code>{c}</code></pre>)}
    </div>
  );
}
