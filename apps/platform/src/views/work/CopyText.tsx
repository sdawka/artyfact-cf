import { Button } from "@/components/ui";
import { useEffect, useState } from "react";

/** Copy button whose accessible name does not repeat the (possibly secret, possibly huge) value. */
export function CopyText({ value, label, name, variant = "secondary", size }: { value: string; label: string; /** Accessible name when the visible label is short ("Copy"). */ name?: string; variant?: "primary" | "secondary" | "ghost"; size?: "standard" | "compact" }) {
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
      <Button type="button" variant={variant} size={size} onClick={copy} aria-label={state === "idle" ? (name ?? label) : undefined}>
        {state === "idle" ? label : state === "copied" ? "Copied" : "Copy failed"}
      </Button>
      <span className="sr-only" role="status">{state === "idle" ? "" : state === "copied" ? "Copied" : "Copy failed"}</span>
    </>
  );
}

