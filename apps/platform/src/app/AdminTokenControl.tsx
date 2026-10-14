import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { LockClosedIcon, LockOpen1Icon } from "@radix-ui/react-icons";
import { Button, Dialog, Input, Popover } from "@/components/ui";
import { StatusText } from "@/components/StatusText/StatusText";
import { useAdminToken } from "@/api/adminToken";
import styles from "./AdminTokenControl.module.css";

/** Window event that opens the token form from anywhere (the command palette's "Admin token…"). */
export const OPEN_ADMIN_TOKEN_EVENT = "artyfact:admin-token";

function TokenForm({ onDone, inputRef }: { onDone(): void; inputRef: RefObject<HTMLInputElement | null> }) {
  const { token, setToken, clear } = useAdminToken();
  const [draft, setDraft] = useState("");
  const uid = useId();
  return <form onSubmit={(event) => { event.preventDefault(); if (draft.trim()) setToken(draft); onDone(); }}>
    <label htmlFor={`${uid}-t`} className={styles.label}>Token for admin actions</label>
    <Input ref={inputRef} id={`${uid}-t`} type="password" value={draft} autoComplete="off" placeholder={token ? "A token is saved; enter a new one to replace it" : ""} onChange={(event) => setDraft(event.target.value)} />
    <p className={styles.note}>Kept in this browser tab's session only. Forms pre-fill from it.</p>
    <div className={styles.actions}>
      <Button type="submit" variant="primary" disabled={!draft.trim()}>Save</Button>
      <Button variant="ghost" className={styles.forget} disabled={!token} onClick={() => { clear(); onDone(); }}>Forget</Button>
    </div>
  </form>;
}

/**
 * The admin token form. Wide screens: a popover under its header button. Compact screens: a Dialog (the button lives in
 * More, so there is no anchor). Token stays in tab session storage.
 */
export function AdminTokenControl({ open: controlledOpen, onOpenChange, compact = false, returnFocus }: {
  open?: boolean; onOpenChange?: (open: boolean) => void; compact?: boolean; returnFocus?: RefObject<HTMLButtonElement | null>;
} = {}) {
  const { token } = useAdminToken();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const setOpen = (next: boolean) => {
    if (!next) (returnFocus?.current ?? button.current)?.focus();
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const openRef = useRef(setOpen);
  openRef.current = setOpen;
  useEffect(() => {
    const onOpen = () => openRef.current(true);
    window.addEventListener(OPEN_ADMIN_TOKEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ADMIN_TOKEN_EVENT, onOpen);
  }, []);
  const focusInput = (event: Event) => { event.preventDefault(); input.current?.focus(); };
  const returnFocusTo = (event: Event) => { event.preventDefault(); (returnFocus?.current ?? button.current)?.focus(); };
  if (compact) {
    return <Dialog open={open} onOpenChange={setOpen} title="Admin token" onOpenAutoFocus={focusInput} onCloseAutoFocus={returnFocusTo} onEscapeKeyDown={(event) => event.stopPropagation()}>
      <TokenForm onDone={() => setOpen(false)} inputRef={input} />
    </Dialog>;
  }
  return <Popover open={open} onOpenChange={setOpen} label="Admin token" align="end" className={styles.pop}
    onOpenAutoFocus={focusInput}
    onEscapeKeyDown={(event) => event.stopPropagation()}
    onCloseAutoFocus={returnFocusTo}
    trigger={<Button ref={button} title="Platform admin token, kept for this browser session">
      {token ? <LockClosedIcon aria-hidden="true" /> : <LockOpen1Icon aria-hidden="true" />}
      {token ? <>Admin <StatusText status="set" glyph="" /></> : "Admin token"}
    </Button>}>
    <h2 className={styles.title}>Admin token</h2>
    <TokenForm onDone={() => setOpen(false)} inputRef={input} />
  </Popover>;
}
