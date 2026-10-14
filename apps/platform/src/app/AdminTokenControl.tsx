import { useId, useRef, useState, type RefObject } from "react";
import { LockClosedIcon } from "@radix-ui/react-icons";
import { Button, Input, Popover } from "@/components/ui";
import { useAdminToken } from "@/api/adminToken";
import styles from "./AdminTokenControl.module.css";

/** Token stays in tab session storage; the panel uses viewport collision handling. */
export function AdminTokenControl({ open: controlledOpen, onOpenChange, triggerHidden = false, returnFocus }: {
  open?: boolean; onOpenChange?: (open: boolean) => void; triggerHidden?: boolean; returnFocus?: RefObject<HTMLButtonElement | null>;
} = {}) {
  const { token, setToken, clear } = useAdminToken();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const [draft, setDraft] = useState("");
  const uid = useId();
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const setOpen = (next: boolean) => {
    if (!next) { setDraft(""); (returnFocus?.current ?? button.current)?.focus(); }
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  return <Popover open={open} onOpenChange={setOpen} label="Admin token" align="end" className={styles.pop}
    onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }}
    onEscapeKeyDown={(event) => event.stopPropagation()}
    onCloseAutoFocus={(event) => { event.preventDefault(); (returnFocus?.current ?? button.current)?.focus(); }}
    trigger={<Button ref={button} className={triggerHidden ? styles.mobileAnchor : undefined} aria-hidden={triggerHidden || undefined} tabIndex={triggerHidden ? -1 : undefined} title="Platform admin token, kept for this browser session"><LockClosedIcon aria-hidden="true" />{token ? "Admin: set" : "Admin token"}</Button>}>
    <h2 className={styles.title}>Admin token</h2>
    <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) setToken(draft); setOpen(false); }}>
      <label htmlFor={`${uid}-t`} className={styles.label}>Token for admin actions</label>
      <Input ref={input} id={`${uid}-t`} type="password" value={draft} autoComplete="off" placeholder={token ? "A token is saved; enter a new one to replace it" : ""} onChange={(event) => setDraft(event.target.value)} />
      <p className={styles.note}>Kept in this browser tab's session only. Forms pre-fill from it.</p>
      <div className={styles.actions}>
        <Button type="submit" disabled={!draft.trim()}>Save</Button>
        <Button disabled={!token} onClick={() => { clear(); setOpen(false); }}>Forget</Button>
        <Button onClick={() => setOpen(false)}>Close</Button>
      </div>
    </form>
  </Popover>;
}
