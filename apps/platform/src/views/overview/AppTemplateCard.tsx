import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import type { TemplateUpgradeAction, TemplateUpgradeFile, TemplateUpgradePlan } from "../../../shared/api";
import { useAdminTokenField } from "@/api/adminToken";
import { ApiRequestError } from "@/api/client";
import { useApplyTemplateUpgrade, useTemplateUpgrade } from "@/api/queries";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import workStyles from "../work/work.module.css";
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

/** Overview card: is the app repo behind its Thing template's current scaffold? Opens the upgrade review. */
export function AppTemplateCard() {
  const uid = useId();
  const m = useModel();
  const fixture = m.bundle.source === "fixture";
  const query = useTemplateUpgrade({ enabled: !fixture });
  const [open, setOpen] = useState(false);
  // A template with no scaffold has nothing to upgrade from: no card.
  if (query.data && "status" in query.data) return null;
  const data = query.data;

  const reason = fixture
    ? FIXTURE_REASON
    : query.isError
      ? `The plan could not be read: ${query.error.message}`
      : data?.upToDate
        ? "The app already matches the template."
        : null;

  return (
    <section className={styles.card} aria-labelledby={`${uid}-h`}>
      <h2 id={`${uid}-h`} className={styles.cardTitle}>App template</h2>
      {fixture || query.isError ? (
        <p className={styles.plainText}><span className={styles.unknown}>unknown</span></p>
      ) : query.isLoading || !data ? (
        <p role="status" className={styles.muted}>Checking the app template…</p>
      ) : (
        <p className={styles.plainText}>
          {status(data)}
          {data.from && data.from !== data.to ? ` (scaffolded at ${short(data.from)})` : ""}
          {!data.locked ? ". The app repo has no template lock, so edited files show as conflicts." : "."}
        </p>
      )}
      <div className={workStyles.actions}>
        <button
          type="button"
          className={`u-brackets ${workStyles.primary}`}
          disabled={!!reason || !data}
          aria-expanded={open}
          aria-describedby={reason ? `${uid}-why` : undefined}
          onClick={() => setOpen((o) => !o)}
        >
          Review upgrade
        </button>
        {reason && <span id={`${uid}-why`} className={workStyles.reason}>{reason}</span>}
      </div>
      {open && data && !data.upToDate && <TemplateUpgradePanel plan={data} />}
    </section>
  );
}

/** The plan grouped by action; conflicts can opt into the template version. Starts the upgrade as an ordinary candidate. */
export function TemplateUpgradePanel({ plan }: { plan: TemplateUpgradePlan }) {
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
          void navigate(href("work", { evolution: res.evolution.id, realization: res.realization.id }));
        },
      },
    );
  };

  return (
    <section className={workStyles.panel} aria-labelledby={`${uid}-h`}>
      <h3 id={`${uid}-h`}>Upgrade to {plan.template} at {short(plan.to)}</h3>
      <p className={styles.muted}>
        The upgrade is one commit on a new Evolution: it runs the usual gates and CI preview and is promoted like any other
        change. README and secret files are never touched.
      </p>
      {GROUPS.map(({ action, title }) => {
        const files = plan.files.filter((f) => f.action === action);
        if (!files.length) return null;
        return (
          <div key={action} className={styles.block} role="group" aria-labelledby={`${uid}-${action}`}>
            <h4 id={`${uid}-${action}`} className={styles.blockTitle}>{title} <span className={styles.count}>{files.length}</span></h4>
            <ul className={styles.plain}>
              {files.map((f) => (
                <li key={f.path} className={styles.finding}>
                  <code>{f.path}</code>
                  <span className={styles.muted}>{f.reason}</span>
                  {action === "conflict" && (
                    <label>
                      <input type="checkbox" checked={include.includes(f.path)} onChange={(e) => toggle(f.path, e.target.checked)} aria-label={`Use template version of ${f.path}`} />
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
      <form onSubmit={submit} className={workStyles.form}>
        <div className={workStyles.field}>
          <label htmlFor={`${uid}-k`}>Admin token</label>
          <input id={`${uid}-k`} type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} autoComplete="off" />
        </div>
        <div className={workStyles.actions}>
          <button type="submit" className={`u-brackets ${workStyles.primary}`} disabled={apply.isPending}>
            {apply.isPending ? "Starting…" : "Start upgrade"}
          </button>
        </div>
        {apply.isError && <p role="alert" className={workStyles.error}>{upgradeError(apply.error)}</p>}
      </form>
    </section>
  );
}
