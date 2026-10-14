import { Button, Input } from "@/components/ui";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ApiRequestError, getSystemPart, getSystemParts } from "@/api/client";
import { useSystemRoute } from "@/model/useSelection";
import { PartContents } from "./PartContents";
import styles from "./parts.module.css";

const errorMessage = (error: Error | null) => error instanceof ApiRequestError && [401, 403].includes(error.status)
  ? "This token is not authorized to read private Parts in this System. Enter an admin token or a System realization secret."
  : "Could not load private Parts. Check the connection and try again.";

/** Credentials and private records stay in this mounted System page, never in public catalog caches. */
export default function SystemParts() {
  const { systemId } = useSystemRoute();
  return <PrivateCatalog key={systemId} systemId={systemId} />;
}

function PrivateCatalog({ systemId }: { systemId: string }) {
  const [token, setToken] = useState("");
  const uid = useId();
  const catalog = useMutation({ mutationFn: () => getSystemParts(systemId, token), gcTime: 0 });
  const detail = useMutation({ mutationFn: ({ id, version }: { id: string; version: string }) => getSystemPart(systemId, id, version, token), gcTime: 0 });
  return <section className={styles.catalog} aria-labelledby="private-parts-title">
    <h1 id="private-parts-title">System-private Parts</h1>
    <p>Enter an admin token to inspect this System’s private packages. A System realization secret also grants read access.</p>
    <form className={styles.auth} onSubmit={(event) => { event.preventDefault(); detail.reset(); catalog.mutate(); }}>
      <label htmlFor={uid}>Admin token</label>
      <Input id={uid} type="password" autoComplete="off" disabled={catalog.isPending || detail.isPending} value={token} onChange={(event) => { setToken(event.target.value); catalog.reset(); detail.reset(); }} />
      <Button variant="secondary" type="submit" disabled={!token.trim() || catalog.isPending || detail.isPending}>Load private Parts</Button>
    </form>
    {catalog.isPending && <p role="status">Loading private Parts…</p>}
    {catalog.isError && <p role="alert">{errorMessage(catalog.error)}</p>}
    {catalog.isSuccess && (catalog.data.parts.length === 0 ? <p>No private Parts in this System.</p> : <ul className={styles.list}>
      {catalog.data.parts.map((part) => <li key={`${part.partId}@${part.version}`}><Button variant="ghost" className="u-marker" onClick={() => detail.mutate({ id: part.partId, version: part.version })}>{part.name || part.partId} {part.version}</Button><span>{part.digest}</span></li>)}
    </ul>)}
    {detail.isPending && <p role="status">Loading pinned package…</p>}
    {detail.isError && <p role="alert">{errorMessage(detail.error)}</p>}
    {detail.isSuccess && <PartContents part={detail.data.part} />}
  </section>;
}
