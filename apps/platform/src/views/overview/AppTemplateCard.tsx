import { Button, Checkbox, Input } from "@/components/ui";
import { Count } from "@/components/Count/Count";
import { Panel } from "@/components/Panel/Panel";
import { Unknown } from "@/components/Unknown/Unknown";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import type { TemplateUpgradeAction, TemplateUpgradeFile, TemplateUpgradePlan } from "../../../shared/api";
import { useAdminTokenField } from "@/api/adminToken";
import { ApiRequestError } from "@/api/client";
import { useApplyTemplateUpgrade, useTemplateUpgrade } from "@/api/queries";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { formStyles as workStyles } from "@/components/Form/Form";
import styles from "./Overview.module.css";

const FIXTURE_REASON = "Template upgrades need the platform API. The UI is showing fixture data.";
const GROUPS: { action: TemplateUpgradeAction; title: string }[] = [
  { action: "add", title: "Add" },
  { action: "update", title: "Update" },
  { action: "remove", title: "Remove" },
  { action: "conflict", title: "Conflict" },
];

const short = (c: string | null | undefined) => (c ? c.slice(0, 7) : "none");

/** Plain wording for the two auth refusals and "already up to date"; anything else keeps the server's message. */
export function upgradeError(err: Error): string {
  if (err instanceof ApiRequestError && err.status === 401) return "The upgrade needs the admin token (401). Set the admin token in the header and try again.";
  if (err instanceof ApiRequestError && err.status === 403) return "The admin token was refused (403). Check it in the header and try again.";
  if (err instanceof ApiRequestError && err.code === "up-to-date") return "The app is already up to date with the template.";
  return err.message;
}

/** The plan's headline: up to date, N files behind, or a lock to record. */
function status(plan: TemplateUpgradePlan): string {
  if (plan.upToDate) return `up to date with ${plan.template} at ${short(plan.to)}`;
  const n = plan.files.length;
  if (n === 0) return `no file to change; the upgrade records the template lock (${plan.template} at ${short(plan.to)})`;
  return `${n} file${n === 1 ? "" : "s"} behind ${plan.template} at ${short(plan.to)}`;
}

/** The app template reading for the Facts strip: the one-line status, why Review upgrade is unavailable, and the plan. */
export function useAppTemplate() {
  const m = useModel();
  const fixture = m.bundle.source === "fixture";
  const query = useTemplateUpgrade({ enabled: !fixture });
  // A template with no scaffold has nothing to upgrade from: no row.
  if (query.data && "status" in query.data) return { hidden: true as const };
  const plan = query.data;
  const reason = fixture
    ? FIXTURE_REASON
    : query.isError
      ? `The plan could not be read: ${query.error.message}`
      : plan?.upToDate
        ? "The app already matches the template."
        : null;
  const summary: ReactNode = fixture || query.isError ? (
    <Unknown />
  ) : query.isLoading || !plan ? (
    <span role="status">Checking the app template…</span>
  ) : (
    <>
      {status(plan)}
      {plan.from && plan.from !== plan.to ? ` (scaffolded at ${short(plan.from)})` : ""}
      {!plan.locked ? ". The app repo has no template lock, so edited files show as conflicts." : "."}
    </>
  );
  return { hidden: false as const, plan, reason, summary };
}

/** The plan grouped by action; conflicts can opt into the template version. Starts the upgrade as an ordinary candidate. */
export function TemplateUpgradePanel({ plan, onBack }: { plan: TemplateUpgradePlan; onBack: () => void }) {
  const uid = useId();
  const href = useKeepParams();
  const navigate = useNavigate();
  const apply = useApplyTemplateUpgrade();
  const [include, setInclude] = useState<string[]>([]);
  // Pre-filled from the header token; a typed value is a one-off.
  const [adminToken, setAdminToken, resetAdminToken] = useAdminTokenField();

  const toggle = (path: string, on: boolean) => setInclude((xs) => (on ? [...xs, path] : xs.filter((x) => x !== path)));
  // The app has its own copy of these, so Compare can show how it changed.
  const comparable = (f: TemplateUpgradeFile) => f.action !== "add" && !/app deleted it/.test(f.reason);

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    apply.mutate(
      { body: { include }, ...(adminToken && { adminToken }) },
      {
        onSuccess: (res) => {
          resetAdminToken();
          void navigate(href("work", res.realizationPlan ? { plan: res.realizationPlan.id, evolution: null, realization: null } : { evolution: res.evolution?.id ?? null, realization: res.realization.id }));
        },
      },
    );
  };

  const formId = `${uid}-form`;
  return (
    <Panel
      title={`Upgrade to ${plan.template} at ${short(plan.to)}`}
      onBack={onBack}
      backLabel="Back to overview"
      primary={<Button type="submit" form={formId} variant="primary" disabled={apply.isPending}>{apply.isPending ? "Starting…" : "Start upgrade"}</Button>}
    >
      <p className={styles.quiet}>
        The upgrade implements the accepted Genome in a Realization Task. Review its candidate, integrate it, and promote the reviewed implementation. README and secret files are never touched.
      </p>
      {GROUPS.map(({ action, title }) => {
        const files = plan.files.filter((f) => f.action === action);
        if (!files.length) return null;
        return (
          <div key={action} className={styles.block} role="group" aria-labelledby={`${uid}-${action}`}>
            <h3 id={`${uid}-${action}`} className={styles.subhead}>{title} <Count n={files.length} /></h3>
            <ul className={styles.plain}>
              {files.map((f) => (
                <li key={f.path} className={styles.finding}>
                  <code>{f.path}</code>
                  <span className={styles.quiet}>{f.reason}</span>
                  {action === "conflict" && (
                    <label>
                      <Checkbox checked={include.includes(f.path)} onChange={(e) => toggle(f.path, e.target.checked)} aria-label={`Use template version of ${f.path}`} />
                      {" "}use template version
                    </label>
                  )}
                  {comparable(f) && <Link to={href("compare", { level: "files", repo: "app", path: f.path })}>Compare</Link>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <form id={formId} onSubmit={submit} className={workStyles.form}>
        <div className={workStyles.field}>
          <label htmlFor={`${uid}-k`}>Admin token</label>
          <Input id={`${uid}-k`} type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} autoComplete="off" />
        </div>
        {apply.isError && <p role="alert" className={workStyles.error}>{upgradeError(apply.error)}</p>}
      </form>
    </Panel>
  );
}
