import { useEffect, useId, useRef, useState } from "react";
import { useAdminToken } from "@/api/adminToken";
import styles from "./AdminTokenControl.module.css";

/** Header control: enter the platform admin token once; forms pre-fill from it. Held for the browser session only. */
export function AdminTokenControl() {
  const { token, setToken, clear } = useAdminToken();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const uid = useId();
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    setDraft("");
    button.current?.focus();
  };

  return (
    <div
      className={styles.wrap}
      onKeyDown={(e) => {
        if (open && e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className={`u-brackets ${styles.button}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        title="Platform admin token, kept for this browser session"
      >
        <span aria-hidden="true">⚿</span> {token ? "Admin: set" : "Admin token"}
      </button>
      {open && (
        <div role="dialog" aria-labelledby={`${uid}-h`} className={styles.pop}>
          <h2 id={`${uid}-h`} className={styles.title}>Admin token</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) setToken(draft);
              close();
            }}
          >
            <label htmlFor={`${uid}-t`} className={styles.label}>Token for admin actions</label>
            <input
              ref={input}
              id={`${uid}-t`}
              type="password"
              value={draft}
              autoComplete="off"
              placeholder={token ? "A token is saved; enter a new one to replace it" : ""}
              onChange={(e) => setDraft(e.target.value)}
            />
            <p className={styles.note}>Kept in this browser tab's session only. Forms pre-fill from it.</p>
            <div className={styles.actions}>
              <button type="submit" className={`u-brackets ${styles.save}`} disabled={!draft.trim()}>Save</button>
              <button type="button" className={`u-brackets ${styles.forget}`} disabled={!token} onClick={() => { clear(); close(); }}>Forget</button>
              <button type="button" className={`u-brackets ${styles.forget}`} onClick={close}>Close</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
