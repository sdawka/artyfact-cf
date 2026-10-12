import { useEffect, useState } from "react";
import styles from "./CopyButton.module.css";

/** Copies `value` to the clipboard; says "Copied" for a moment. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className={`u-brackets ${styles.button}`}
      aria-label={`${label} ${value}`}
      onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true), () => undefined)}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
