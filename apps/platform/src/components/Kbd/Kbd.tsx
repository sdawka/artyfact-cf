import styles from "./Kbd.module.css";

/** True on Apple platforms, where the command key is ⌘ and chords are written without "+". */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform || nav.platform || nav.userAgent;
  return /mac|iphone|ipad|ipod/i.test(p);
}

/** "Mod" (or "⌘" / "Ctrl") becomes ⌘ on Apple platforms and Ctrl elsewhere. */
export function platformKey(key: string, apple = isApplePlatform()): string {
  if (/^(mod|⌘|cmd|ctrl)$/i.test(key)) return apple ? "⌘" : "Ctrl";
  if (/^(alt|option|⌥)$/i.test(key)) return apple ? "⌥" : "Alt";
  if (/^(shift|⇧)$/i.test(key)) return apple ? "⇧" : "Shift";
  if (/^(enter|return|⏎)$/i.test(key)) return "Enter";
  return key;
}

export interface KbdProps {
  /** Keys of one chord (`["Mod", "K"]`) or a sequence (`["g", "w"]` with `sequence`). */
  keys: string[];
  /** Keys pressed one after another ("g then w") rather than together. */
  sequence?: boolean;
}

/** Keyboard hint: UI face, `--type-hint`, subtle border. Platform-aware (⌘ K on a Mac, Ctrl+K elsewhere). */
export function Kbd({ keys, sequence = false }: KbdProps) {
  const apple = isApplePlatform();
  const shown = keys.map((k) => platformKey(k, apple));
  const sep = sequence ? " then " : apple ? "" : "+";
  return (
    <kbd className={styles.combo}>
      {shown.map((k, i) => (
        <span key={i} className={styles.part}>
          {i > 0 && sep && <span className={styles.sep}>{sep}</span>}
          <kbd className={styles.key}>{k}</kbd>
        </span>
      ))}
    </kbd>
  );
}
