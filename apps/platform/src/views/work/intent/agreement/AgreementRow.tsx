import type { ReactNode } from "react";
import type { ProposalPlanNode } from "../../../../../shared/api";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { kindColour, type KindViews } from "@/model/kinds";
import { countsText, expandable, ROLLUP_WORD, type Decision, type NodeRollup } from "./lib";
import styles from "./agreement.module.css";

const BUTTONS: { decision: Decision; label: string }[] = [
  { decision: "agree", label: "Agree" },
  { decision: "reject", label: "Reject" },
  { decision: "defer", label: "Defer" },
];

/** What every row of one tree shares. */
export interface RowContext {
  rollups: Map<string, NodeRollup>;
  /** Node → the nodes it needs that are rejected or deferred. */
  needs: Map<string, string[]>;
  /** Nodes whose subtree has an op with an `error` problem: they cannot be agreed. */
  errors: Set<string>;
  titles: Map<string, string>;
  expanded: ReadonlySet<string>;
  activeId: string | undefined;
  variant: "intent" | "genome";
  readOnly: string | null;
  views: KindViews;
  decide(nodeId: string, decision: Decision | null): void;
  toggle(nodeId: string): void;
  activate(nodeId: string): void;
  register(nodeId: string, el: HTMLLIElement | null): void;
  renderOps?(node: ProposalPlanNode): ReactNode;
}

/** One node of the agreement tree: its row (kind glyph, title, counts, rollup, decisions) and, open, its ops and children. */
export function AgreementRow({ node, level, posInSet, setSize, ctx }: {
  node: ProposalPlanNode;
  level: number;
  posInSet: number;
  setSize: number;
  ctx: RowContext;
}) {
  const r = ctx.rollups.get(node.id)!;
  const view = ctx.views.of(node.kind);
  const open = ctx.expanded.has(node.id);
  const canOpen = expandable(node);
  const counts = countsText(r.changes);
  const word = ROLLUP_WORD[r.rollup];
  const needs = (ctx.needs.get(node.id) ?? []).map((id) => ctx.titles.get(id) ?? id);
  const hasErrors = ctx.errors.has(node.id);
  const buttons = BUTTONS.filter((b) => ctx.variant === "intent" || b.decision !== "defer");
  const label = [node.title, view.label, word, counts, needs.length ? `needs ${needs.join(", ")}` : ""].filter(Boolean).join(", ");
  return (
    <li
      ref={(el) => ctx.register(node.id, el)}
      role="treeitem"
      aria-level={level}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-label={label}
      {...(canOpen && { "aria-expanded": open })}
      tabIndex={ctx.activeId === node.id ? 0 : -1}
      data-node-id={node.id}
      data-decision={r.rollup}
      data-active={ctx.activeId === node.id || undefined}
      className={styles.item}
      onFocus={(e) => {
        if (e.target === e.currentTarget) ctx.activate(node.id);
      }}
    >
      <div className={styles.row} onClick={() => ctx.activate(node.id)}>
        <span
          className={styles.twisty}
          aria-hidden="true"
          onClick={(e) => {
            if (!canOpen) return;
            e.stopPropagation();
            ctx.activate(node.id);
            ctx.toggle(node.id);
          }}
        >
          {canOpen ? (open ? "▾" : "▸") : ""}
        </span>
        <span className={styles.glyph} style={kindColour(view)} aria-hidden="true">{view.glyph}</span>
        <span className={styles.title}>{node.title}</span>
        <span className="sr-only">, {view.label}</span>
        {counts && <StatusChip status="changes" label={counts} />}
        <StatusChip status={`decision-${r.rollup}`} label={r.inherited && r.rollup !== "mixed" ? `${word} (inherited)` : word} tone={r.rollup === "undecided" ? "attention" : "neutral"} />
        {needs.length > 0 && <StatusChip status="needs" label={`needs ${needs.join(", ")}`} tone="attention" />}
        {hasErrors && <StatusChip status="error" label="has errors" tone="fail" />}
        <span className={styles.decide} role="group" aria-label={`Decide ${node.title}`}>
          {buttons.map((b) => {
            const blocked = ctx.readOnly ?? (b.decision === "agree" && hasErrors ? "Changes with errors cannot be agreed." : null);
            return (
              <button
                key={b.decision}
                type="button"
                data-decision={b.decision}
                aria-pressed={r.effective === b.decision}
                aria-label={`${b.label} ${node.title}`}
                disabled={!!blocked}
                title={blocked ?? undefined}
                // Only the active row's buttons are tab stops; a, r and d decide from the row itself.
                tabIndex={ctx.activeId === node.id ? 0 : -1}
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.activate(node.id);
                  ctx.decide(node.id, node.decision === b.decision ? null : b.decision);
                }}
              >
                {b.label}
              </button>
            );
          })}
        </span>
      </div>
      {open && (
        <div className={styles.body}>
          {node.summary && node.summary !== counts && <p className={styles.summary}>{node.summary}</p>}
          {node.opIds.length > 0 && ctx.renderOps?.(node)}
          {node.children.length > 0 && (
            <ul role="group" className={styles.group}>
              {node.children.map((c, i) => (
                <AgreementRow key={c.id} node={c} level={level + 1} posInSet={i + 1} setSize={node.children.length} ctx={ctx} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
