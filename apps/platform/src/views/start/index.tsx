import { Button, Input, Textarea, Checkbox } from "@/components/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { SystemsResponse } from "../../../shared/api";
import type { NativeOntologyPackage, OntologyImportReview } from "../../../shared/ontology-packages";
import { useAdminToken } from "@/api/adminToken";
import { lifecycleApi, scopedRequest } from "@/api/lifecycle";
import { shellArg } from "../../../shared/shell";
import { CommandBlock } from "@/components/CommandBlock/CommandBlock";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { EntryLayout } from "@/components/EntryLayout/EntryLayout";
import { Check, Field, Form, FormActions } from "@/components/Form/Form";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { StatusText } from "@/components/StatusText/StatusText";
import { Steps, type Step } from "@/components/Steps/Steps";
import { HomeHeader } from "../home/HomeHeader";
import styles from "./start.module.css";

const NO_TOKEN = "Set the admin token in the header.";

/** Parse pasted JSON, naming the field in the error instead of surfacing a raw SyntaxError. */
function parseJson(what: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${what} is not valid JSON (${(e as Error).message})`);
  }
}

/** `/start`: create a System, preview and accept its ontology, then hand the project to a local agent. */
export default function StartView() {
  const [params, setParams] = useSearchParams();
  const { token } = useAdminToken();
  const [system, setSystem] = useState(params.get("system") ?? "");
  const [title, setTitle] = useState("");
  const [created, setCreated] = useState(!!params.get("system"));
  const [source, setSource] = useState("");
  const [genomeFiles, setGenomeFiles] = useState("");
  const [review, setReview] = useState<OntologyImportReview>();
  const [reopened, setReopened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);
  const [outcomes, setOutcomes] = useState(false);
  const sourceRef = useRef<HTMLTextAreaElement>(null);

  const starter = (): NativeOntologyPackage => ({
    format: "artyfact.ontology-package@1", id: "custom.domain", version: "1", dependencies: [],
    templates: { "template.system.custom@1": { id: "template.system.custom", version: 1, meta: 1, extends: outcomes ? "template.meta.outcomes@1" : "template.meta.artyfact-genome@1", kinds: { component: { parents: ["system"], fields: [{ name: "name", type: "string" }] } } } },
  });
  /** Runs one action; a failure reads "{what failed}: {cause}" inside the active step. */
  const run = async (failed: string, fn: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try { await fn(); } catch (e) { setError(`${failed}: ${(e as Error).message}`); } finally { setBusy(false); }
  };
  useEffect(() => {
    const id = params.get("import");
    if (id && review?.id !== id && system && token) void run("Could not load the import", async () => setReview(await lifecycleApi.importReview(system, id, token)));
  }, [params.get("import"), system, token]);
  useEffect(() => { if (created && !review) sourceRef.current?.focus(); }, [created]);

  const create = () => run("Could not create the System", async () => {
    await lifecycleApi.initial({ systemId: system, title: title || undefined }, token);
    setCreated(true);
    setParams({ system });
  });
  const preview = () => run("Could not preview", async () => {
    const files = genomeFiles.trim() ? { genomeFiles: parseJson("Genome files", genomeFiles) as Record<string, string> } : {};
    const next = await lifecycleApi.preview(system, { package: parseJson("The package", source) as NativeOntologyPackage, ...files }, token);
    setReview(next);
    setReopened(false);
    setParams({ system, import: next.id });
  });
  const accept = () => run("Could not accept the import", async () => setReview(await lifecycleApi.acceptImport(system, review!.id, { hash: review!.pin!.hash }, token)));
  const check = () => run("Could not check", async () => {
    const result = await scopedRequest<SystemsResponse>("/api/systems", token);
    if (!result.systems.some((s) => s.systemId === system)) throw new Error("Complete the local bootstrap command first, then check again.");
    setRegistered(true);
  });

  const stage = !created ? 1 : !review || reopened ? 2 : review.status === "accepted" ? 4 : 3;
  const pin = review?.pin && `${review.pin.id}@${review.pin.version}`;
  const err = error && <p role="alert" className={styles.error}>{error}</p>;
  const origin = window.location.origin;

  const steps: Step[] = [
    { id: "name", title: "Name your System", state: stage === 1 ? "current" : "done", summary: `${system} created` },
    { id: "preview", title: "Preview your ontology", state: stage === 2 ? "current" : stage > 2 ? "done" : "todo", summary: pin ? `Previewed ${pin}` : "Previewed" },
    { id: "review", title: "Review the import", state: stage === 3 ? "current" : stage > 3 ? "done" : "todo", summary: pin ? `Accepted ${pin}` : "Accepted" },
    { id: "agent", title: "Build with your agent", state: stage === 4 ? "current" : "todo" },
  ];
  if (review && review.status !== "accepted" && stage === 3) steps[1]!.onEdit = () => setReopened(true);

  let body: ReactNode;
  if (stage === 1) {
    body = (
      <Form className={styles.step} aria-busy={busy} onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <div className={`${styles.fields} ${styles.narrow}`}>
          <div>
            <Field label="System ID"><Input id="start-system" value={system} onChange={(e) => setSystem(e.target.value)} required disabled={busy} /></Field>
            <p className={styles.hint}>For example <code>system.notes</code>. It cannot change after creation.</p>
          </div>
          <Field label="Title"><Input id="start-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></Field>
        </div>
        <FormActions>
          <Button type="submit" variant="primary" disabled={busy} reason={!token ? NO_TOKEN : !system.trim() ? "Enter a System ID." : undefined}>{busy ? "Working…" : "Create System"}</Button>
        </FormActions>
        {err}
      </Form>
    );
  } else if (stage === 2) {
    body = (
      <div className={styles.step} aria-busy={busy}>
        <p>Paste a native package (<code>artyfact.ontology-package@1</code>). For other sources, ask your agent to convert them; you review the conversion here before accepting it.</p>
        <FormActions>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setSource(JSON.stringify(starter(), null, 2))}>Use starter package</Button>
          <Check><Checkbox checked={outcomes} onChange={(e) => setOutcomes(e.target.checked)} disabled={busy} />Include outcomes vocabulary (events, expected effects, assays)</Check>
        </FormActions>
        <Form onSubmit={(e) => { e.preventDefault(); void preview(); }}>
          <Field label="Native ontology package"><Textarea ref={sourceRef} id="start-source" className={styles.source} rows={12} value={source} onChange={(e) => setSource(e.target.value)} required disabled={busy} /></Field>
          <details className={styles.disclosure}>
            <summary>Add reviewed Genome files (optional)</summary>
            <p className={styles.hint}>Provide native node files when your template needs initial content or required fields: a JSON object mapping relative file paths to their exact contents.</p>
            <Field label="Genome files (optional JSON)"><Textarea id="start-genome-files" className={styles.source} rows={6} value={genomeFiles} onChange={(e) => setGenomeFiles(e.target.value)} disabled={busy} /></Field>
          </details>
          <FormActions>
            <Button type="submit" variant="primary" disabled={busy} reason={!token ? NO_TOKEN : !source.trim() ? "Paste a package first." : undefined}>Preview import</Button>
          </FormActions>
        </Form>
        {err}
      </div>
    );
  } else if (stage === 3 && review) {
    body = (
      <div className={styles.step} aria-busy={busy} aria-live="polite">
        <StatusText status={review.status} tone={review.status === "invalid" ? "fail" : "attention"} label={review.status === "invalid" ? "Invalid package" : "Waiting for your review"} />
        {pin && <div className={styles.pin}><span>Pinned</span><code>{pin}</code><CopyButton value={pin} /></div>}
        {review.issues.length === 0
          ? <p className={styles.hint}>No issues found.</p>
          : <ul className={styles.issues}>{review.issues.map((issue, i) => <li key={i} className={styles.issue}><StatusText status="issue" tone="fail" label="Issue" /><code>{issue.path}</code><span>{issue.message}</span></li>)}</ul>}
        <details className={styles.disclosure}>
          <summary>Templates and preserved source</summary>
          <ul>{review.templateRefs.map((ref) => <li key={ref}><code>{ref}</code></li>)}</ul>
          <pre tabIndex={0} className={styles.code}>{JSON.stringify(review.package, null, 2)}</pre>
        </details>
        {review.genomeFiles && <details className={styles.disclosure}><summary>Reviewed Genome files</summary><pre tabIndex={0} className={styles.code}>{JSON.stringify(review.genomeFiles, null, 2)}</pre></details>}
        {review.status === "review" && review.pin && (
          <FormActions>
            <Button variant="primary" disabled={busy} reason={!token ? NO_TOKEN : undefined} onClick={() => void accept()}>Accept reviewed import</Button>
            <span className={styles.hint}>Accepting pins {pin}.</span>
          </FormActions>
        )}
        {err}
      </div>
    );
  } else {
    const platform = `--platform ${shellArg(origin)}`;
    body = (
      <div className={styles.step} aria-busy={busy}>
        <p>The package is accepted. Run these in order; your agent does the building.</p>
        <div className={styles.commands}>
          <CommandBlock commands={[
            `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology bootstrap ${shellArg(review!.id)} --system ${shellArg(system)} --dir ./project --prepare-only ${platform}`,
            "npx artyfact skill --dir ./project --write --agent generic",
          ]}>
            <p>Prepare the accepted Genome locally and install the agent guidance in that project. Set ADMIN_TOKEN in your shell without exporting it; the header token only authorizes this browser.</p>
          </CommandBlock>
          <p>Ask your agent to follow “Prepare an accepted import locally” in ./project/AGENTS.md.</p>
          <CommandBlock commands={[`ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact init --dir ./project ${platform}`]}>
            <p>Import the project, then accept its Genome in Review before planning.</p>
          </CommandBlock>
          <CommandBlock commands={[`ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan draft --system ${shellArg(system)} --node '<source-bound-node-id>' ${platform}`]}>
            <p>Draft a plan from actual source-bound node ids (<code>--node</code>), review the printed scope and problems, then repeat with <code>--create</code>.</p>
          </CommandBlock>
        </div>
        <details className={styles.disclosure}>
          <summary>Why these steps</summary>
          <p>A Genome-only System with no Thing or source is a valid completion. To implement it, prepare minimal genuine scaffold source in ./project/app and accurate Thing, artifact and files mappings; leave feature work to Tasks. Custom packages use server import validation.</p>
          <p>Default import review must stay enabled when Genome content changes. After acceptance, choose actual source-bound node IDs from the Genome. Draft with each ID using --node, review the printed scope and problems, then repeat that command with --create.</p>
          <p>Preparation can be resumed in ./project; bootstrap refuses to overwrite it. If init reports no app, finish its scaffold or use a matching --from-template; do not invent source bindings.</p>
        </details>
        {registered
          ? <FormActions><span>System registered.</span><Button asChild variant="primary"><Link to={`/s/${encodeURIComponent(system)}/r/head/work`}>Open System work</Link></Button></FormActions>
          : <FormActions><Button variant="primary" disabled={busy} reason={!token ? NO_TOKEN : undefined} onClick={() => void check()}>Check local bootstrap completion</Button></FormActions>}
        {error && (error.includes("Complete the local bootstrap") ? <p className={styles.pending}>{error.replace("Could not check: ", "")}</p> : err)}
      </div>
    );
  }
  return (
    <EntryLayout header={<HomeHeader />}>
      <div className={styles.page}>
        <PageHeader title="Start a System" purpose="Create a System, review its ontology, then hand it to your agent." context={null} />
        <Steps steps={steps} label="Start a System steps">{body}</Steps>
      </div>
    </EntryLayout>
  );
}
