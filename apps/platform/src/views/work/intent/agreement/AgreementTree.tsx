import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ProposalPlanNode, ProposalProblem, ProposedOp } from "../../../../../shared/api";
import { useKindViews } from "@/model/kinds";
import { AgreementRow, type RowContext } from "./AgreementRow";
import { blockedBy, expandable, flatten, initialExpanded, rollupPlan, walk, type Decision } from "./lib";
import styles from "./agreement.module.css";

export interface AgreementTreeProps {
  plan: ProposalPlanNode[];
  /** The ops the nodes own (counts by verb, dependency blocking); absent, every op counts as an add. */
  ops?: readonly ProposedOp[];
  problems?: readonly ProposalProblem[];
  /** `intent`: agree / reject / defer. `genome` (import and amendment review): agree / reject. */
  variant?: "intent" | "genome";
  /** Why decisions are disabled (fixture data, a closed proposal); the tree stays navigable. */
  readOnly?: string | null;
  onDecide(nodeId: string, decision: Decision | null): void;
  /** What an open node shows for its own ops (the op diffs). */
  renderOps?(node: ProposalPlanNode): ReactNode;
  label?: string;
}

const NO_OPS: readonly ProposedOp[] = [];
const NO_PROBLEMS: readonly ProposalProblem[] = [];
const KEY_DECISION: Record<string, Decision> = { a: "agree", r: "reject", d: "defer" };

/**
 * The hierarchical agreement tree: one row per node, decided as a whole (children inherit; a child decided later
 * overrides). One tab stop with roving focus: ↑↓ move, → opens or enters, ← closes or goes to the parent, Home/End,
 * Enter/Space open and close, a/r/d decide, Backspace clears the node's own decision.
 */
export function AgreementTree({ plan, ops = NO_OPS, problems = NO_PROBLEMS, variant = "intent", readOnly = null, onDecide, renderOps, label = "Agreement" }: AgreementTreeProps) {
  const uid = useId();
  const views = useKindViews();
  const sig = useMemo(() => walk(plan).map((n) => n.id).join("\n"), [plan]);
  const [open, setOpen] = useState(() => ({ sig, set: initialExpanded(plan) }));
  const expanded = open.sig === sig ? open.set : initialExpanded(plan);
  const rows = useMemo(() => flatten(plan, expanded), [plan, expanded]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const active = rows.find((r) => r.node.id === activeId) ?? rows[0];
  const els = useRef(new Map<string, HTMLLIElement>());

  const rollups = useMemo(() => rollupPlan(plan, ops), [plan, ops]);
  const needs = useMemo(() => blockedBy(plan, ops), [plan, ops]);
  const errors = useMemo(() => {
    const bad = new Set(problems.filter((p) => p.severity === "error" && p.opId).map((p) => p.opId!));
    const out = new Set<string>();
    const visit = (n: ProposalPlanNode): boolean => {
      const own = n.opIds.some((id) => bad.has(id));
      const kids = n.children.map(visit).some(Boolean);
      if (own || kids) out.add(n.id);
      return own || kids;
    };
    plan.forEach(visit);
    return out;
  }, [plan, problems]);
  const titles = useMemo(() => new Map(walk(plan).map((n) => [n.id, n.title])), [plan]);

  const setExpanded = useCallback(
    (f: (prev: ReadonlySet<string>) => Set<string>) => setOpen((o) => ({ sig, set: f(o.sig === sig ? o.set : initialExpanded(plan)) })),
    [sig, plan],
  );
  const toggle = useCallback(
    (id: string) => setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    }),
    [setExpanded],
  );
  const decide = useCallback((id: string, d: Decision | null) => {
    if (!readOnly) onDecide(id, d);
  }, [readOnly, onDecide]);

  const ctx: RowContext = {
    rollups, needs, errors, titles, expanded, variant, readOnly, views, decide, toggle, renderOps,
    activeId: active?.node.id,
    activate: setActiveId,
    register: (id, el) => {
      if (el) els.current.set(id, el);
      else els.current.delete(id);
    },
  };

  const focus = (id: string) => {
    setActiveId(id);
    els.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement;
    const id = target.getAttribute("role") === "treeitem" ? target.dataset.nodeId : undefined;
    const i = rows.findIndex((r) => r.node.id === id);
    const row = rows[i];
    if (!row) return;
    const node = row.node;
    const isOpen = expanded.has(node.id);
    const move = (to: number) => focus(rows[Math.min(rows.length - 1, Math.max(0, to))]!.node.id);
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "ArrowDown") move(i + 1);
    else if (key === "ArrowUp") move(i - 1);
    else if (key === "Home") move(0);
    else if (key === "End") move(rows.length - 1);
    else if (key === "ArrowRight") {
      if (!expandable(node)) return;
      if (!isOpen) toggle(node.id);
      else if (node.children.length) move(i + 1);
    } else if (key === "ArrowLeft") {
      if (isOpen) toggle(node.id);
      else if (row.parent) focus(row.parent);
      else return;
    } else if (key === "Enter" || key === " ") {
      if (!expandable(node)) return;
      toggle(node.id);
    } else if (key === "Backspace") decide(node.id, null);
    else if (KEY_DECISION[key] && (variant === "intent" || key !== "d")) {
      const d = KEY_DECISION[key]!;
      if (d === "agree" && errors.has(node.id)) return;
      decide(node.id, d);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className={styles.wrap}>
      <ul role="tree" aria-label={label} aria-describedby={`${uid}-hint`} className={styles.tree} onKeyDown={onKeyDown}>
        {plan.map((n, i) => (
          <AgreementRow key={n.id} node={n} level={1} posInSet={i + 1} setSize={plan.length} ctx={ctx} />
        ))}
      </ul>
      <p id={`${uid}-hint`} className={styles.hint}>
        <kbd>↑</kbd> <kbd>↓</kbd> move · <kbd>→</kbd> <kbd>←</kbd> open and close · <kbd>a</kbd> agree · <kbd>r</kbd> reject
        {variant === "intent" && <> · <kbd>d</kbd> defer</>} · <kbd>Backspace</kbd> clears
      </p>
    </div>
  );
}
