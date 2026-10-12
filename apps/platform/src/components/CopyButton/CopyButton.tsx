import { useEffect, useState } from "react";
import styles from "./CopyButton.module.css";

type State = "idle" | "copied" | "failed";
const TEXT: Record<Exclude<State, "idle">, string> = { copied: "Copied", failed: "Copy failed" };

/** Copies `value` to the clipboard; says "Copied" (or "Copy failed") for a moment, also to screen readers. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<State>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1500);
    return () => clearTimeout(t);
  }, [state]);
  const copy = () => {
    const write = navigator.clipboard?.writeText(value) ?? Promise.reject(new Error("clipboard unavailable"));
    write.then(() => setState("copied"), () => setState("failed"));
  };
  return (
    <>
      <button
        type="button"
        className={`u-brackets ${styles.button}`}
        {...(state === "idle" && { "aria-label": `${label} ${value}` })}
        onClick={copy}
      >
        {state === "idle" ? label : TEXT[state]}
      </button>
      <span className="sr-only" role="status">{state === "idle" ? "" : TEXT[state]}</span>
    </>
  );
}
