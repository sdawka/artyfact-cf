import { Button, Input } from "@/components/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { ApiRequestError, getSystemPart, getSystemParts } from "@/api/client";
import { Field, Form } from "@/components/Form/Form";
import { ListDetail } from "@/components/ListDetail/ListDetail";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Panel } from "@/components/Panel/Panel";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { Row, RowList } from "@/components/RowList/RowList";
import { useModelOptional } from "@/model/useModel";
import { relTime, useNow } from "@/model/time";
import { useSystemRoute } from "@/model/useSelection";
import { PartContents, PartMeta, shortDigest } from "./PartContents";
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
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const uid = useId();
  const now = useNow(60_000);
  const name = useModelOptional()?.bundle.model.system.name || systemId;
  const catalog = useMutation({ mutationFn: () => getSystemParts(systemId, token), gcTime: 0 });
  const detail = useMutation({ mutationFn: ({ id, version }: { id: string; version: string }) => getSystemPart(systemId, id, version, token), gcTime: 0 });
  const open = (id: string, version: string, user: boolean) => { setSelected(`${id}@${version}`); setChosen(user); detail.mutate({ id, version }); };
  // With nothing chosen yet, the detail pane shows the first Part.
  useEffect(() => {
    const first = catalog.data?.parts[0];
    if (first) open(first.partId, first.version, false);
  }, [catalog.data]);
  const gated = catalog.isSuccess && !changing;
  return <>
    <PageHeader title="Private Parts" purpose={`Packages that stay inside ${name}. Reading them needs a token.`} />
    {gated ? (
      <p className={styles.gateDone}>Token loaded. <Button variant="ghost" size="compact" onClick={() => setChanging(true)}>Change</Button></p>
    ) : (
      <Panel title="Read private Parts" headingLevel={2} autoFocus={false} className={styles.gate}>
        <Form onSubmit={(event) => { event.preventDefault(); setChanging(false); setSelected(null); setChosen(false); detail.reset(); catalog.mutate(); }}>
          <Field label="Admin token or realization secret">
            <Input id={uid} type="password" autoComplete="off" disabled={catalog.isPending || detail.isPending} value={token} onChange={(event) => { setToken(event.target.value); catalog.reset(); detail.reset(); }} />
          </Field>
          <p className={styles.quiet}>Kept in memory only.</p>
          <div>
            <Button variant="primary" type="submit" disabled={catalog.isPending || detail.isPending} reason={!token.trim() ? "Enter a token to load." : undefined}>Load private Parts</Button>
          </div>
        </Form>
      </Panel>
    )}
    {catalog.isPending && <p role="status" className={styles.quiet}>Loading private Parts…</p>}
    {catalog.isError && <p role="alert">{errorMessage(catalog.error)}</p>}
    {catalog.isSuccess && (catalog.data.parts.length === 0
      ? <p>No private Parts in this System. <span className={styles.quiet}>Parts are published from the CLI or an agent.</span></p>
      : <ListDetail
          listLabel="Private Parts"
          detailLabel="Part package"
          hasSelection={chosen}
          onBack={() => setChosen(false)}
          backLabel="Back to Private Parts"
          listWidth="wide"
          list={<RowList label="Private Parts list">
            {catalog.data.parts.map((part) => {
              const key = `${part.partId}@${part.version}`;
              return <Row key={key} label={`${part.name || part.partId} ${part.version}`} current={selected === key} onSelect={() => open(part.partId, part.version, true)}
                title={<>{part.name || part.partId} <span className={styles.rowVersion}>{part.version}</span></>}
                meta={<MetaLine items={[{ value: shortDigest(part.digest), code: true, title: part.digest }, { value: relTime(part.publishedAt, now), title: part.publishedAt || undefined }]} />} />;
            })}
          </RowList>}
          detail={<>
            {detail.isPending && <p role="status" className={styles.quiet}>Loading pinned package…</p>}
            {detail.isError && <p role="alert">{errorMessage(detail.error)}</p>}
            {detail.isSuccess && <div className={styles.detail}>
              <div className={styles.detailHead}>
                <h2>{detail.data.part.package.name || detail.data.part.package.id}</h2>
                <p className={styles.quiet}>{detail.data.part.package.description || "No description."}</p>
                <PartMeta part={detail.data.part} />
              </div>
              <PartContents part={detail.data.part} headingLevel={3} />
            </div>}
          </>}
        />)}
  </>;
}
