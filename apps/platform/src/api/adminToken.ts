import { useCallback, useState, useSyncExternalStore } from "react";

/** The one sessionStorage key. Session-scoped on purpose: never localStorage, never logged. */
export const ADMIN_TOKEN_KEY = "artyfact.adminToken";

let memory = "";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? memory;
  } catch {
    return memory;
  }
}

function write(token: string) {
  memory = token;
  try {
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Storage blocked: the in-memory copy keeps the token for this page load.
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The platform admin token entered once in the header; shared by every admin form. */
export function useAdminToken() {
  const token = useSyncExternalStore(subscribe, read, () => "");
  const setToken = useCallback((t: string) => write(t.trim()), []);
  const clear = useCallback(() => write(""), []);
  return { token, setToken, clear };
}

/** A form's token field: pre-filled from the saved token, editable for a one-off, `reset` returns to the saved one. */
export function useAdminTokenField(): [value: string, set: (v: string) => void, reset: () => void] {
  const { token } = useAdminToken();
  const [typed, setTyped] = useState<string | null>(null);
  return [typed ?? token, setTyped, () => setTyped(null)];
}
