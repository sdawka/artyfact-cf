import type { Graph } from "../graph/graph.ts";
import type { Check } from "../meta/schema.ts";
import type { Template } from "../meta/template.ts";
import type { RulePack } from "../meta/schema.ts";
import type { Facts } from "./facts.ts";
import { compilePattern } from "./text.ts";

/**
 * checks@1: the author's checklist per kind (`kinds.<k>.checks`) and for the root nodes (`rootChecks`). The dialect
 * cannot run a regular expression or build a pair subject, so which node each check applies to, and whether a
 * deterministic check's pattern matches, are computed here and emitted as `checkCandidate` and `checkMiss` facts;
 * the pack only turns them into semantic candidates and violations.
 */

/** Owner name of the template-level checks in rule ids: `check:root.<id>`. */
export const ROOT_OWNER = "root";
export const CHECK_PREFIX = "check:";
export const DEFAULT_CHECK_FIELD = "description";
const SEPARATOR = "|";

export const checkRule = (owner: string, id: string): string => `${CHECK_PREFIX}${owner}.${id}`;

export interface OwnedCheck { owner: string; rule: string; check: Check }

/** Every check of the template with its owner (a kind or `root`) and rule id, kinds first in declaration order. */
export function checksOf(t: Pick<Template, "kinds" | "rootChecks">): OwnedCheck[] {
  const out: OwnedCheck[] = [];
  for (const [k, kind] of Object.entries(t.kinds)) for (const c of kind.checks ?? []) out.push({ owner: k, rule: checkRule(k, c.id), check: c });
  for (const c of t.rootChecks ?? []) out.push({ owner: ROOT_OWNER, rule: checkRule(ROOT_OWNER, c.id), check: c });
  return out;
}

export const checkScope = (c: Check) => c.scope ?? "node";
export const checkField = (c: Check) => c.field ?? DEFAULT_CHECK_FIELD;
export const isDeterministic = (c: Check) => c.pattern !== undefined;
const SEVERITY: Record<string, string> = { error: "hard", warning: "soft", info: "advisory" };

type GNode = Graph["nodes"][number];

/** A field's text: a string, or the strings of a list joined by `; `; blank when absent or only whitespace. */
export function fieldText(n: GNode, field: string): string {
  const v = n.fields[field];
  const s = typeof v === "string" ? v : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").join("; ") : "";
  return s.trim() === "" ? "" : s;
}

/** Whether `when` holds for node `n`: its kind, a pattern over a field (default the check's field), or a filled field. */
function holds(c: Check, n: GNode): boolean {
  const w = c.when;
  if (!w) return true;
  if (w.kind !== undefined && n.kind !== w.kind) return false;
  const field = w.field ?? checkField(c);
  if (w.pattern !== undefined) {
    const re = compilePattern(w.pattern);
    return !!re && re.test(fieldText(n, field));
  }
  if (w.field !== undefined) return fieldText(n, field) !== "";
  return true;
}

/**
 * Check facts for one graph. Node scope: every node of the owner kind (root: every node without a parent) where
 * `when` holds. Children scope: every such parent with at least one child where `when` holds, the parent as subject.
 * Pair scope: every two such children of one parent, as `a|b`, smaller id first. A deterministic check (`pattern`)
 * is evaluated on each node (node scope) or each matching child (otherwise) whose field is not blank, and a miss is
 * a `checkMiss`; a blank field is left to completeness@1 and text@1. A semantic check needs text to judge: node scope
 * skips a blank field, and children and pair scope need at least one child with text.
 */
export function checkFacts(t: Pick<Template, "kinds" | "rootChecks">, g: Graph): Facts {
  const checks = checksOf(t);
  if (!checks.length) return {};
  const out: Facts = { checkCandidate: [], checkMiss: [] };
  const children = new Map<string, GNode[]>();
  for (const n of g.nodes) if (n.parent !== undefined) { const l = children.get(n.parent) ?? []; l.push(n); children.set(n.parent, l); }
  for (const { owner, rule, check } of checks) {
    const field = checkField(check);
    const scope = checkScope(check);
    const owners = g.nodes.filter((n) => (owner === ROOT_OWNER ? n.parent === undefined : n.kind === owner));
    const re = check.pattern !== undefined ? compilePattern(check.pattern) : undefined;
    const severity = SEVERITY[check.level ?? "warning"] ?? "soft";
    const test = (n: GNode) => {
      const text = fieldText(n, field);
      if (text !== "" && re && !re.test(text)) out.checkMiss!.push([rule, n.id, severity]);
    };
    for (const p of owners) {
      if (scope === "node") {
        if (!holds(check, p)) continue;
        if (isDeterministic(check)) test(p);
        else if (fieldText(p, field) !== "") out.checkCandidate!.push([rule, p.id, fieldText(p, field)]);
        continue;
      }
      const kids = (children.get(p.id) ?? []).filter((n) => holds(check, n));
      if (isDeterministic(check)) { kids.forEach(test); continue; }
      const texted = kids.filter((n) => fieldText(n, field) !== "");
      if (scope === "children") {
        if (texted.length) out.checkCandidate!.push([rule, p.id, fieldText(p, field)]);
        continue;
      }
      const ids = texted.map((n) => n.id).sort();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        out.checkCandidate!.push([rule, `${ids[i]}${SEPARATOR}${ids[j]}`, fieldText(texted.find((n) => n.id === ids[i])!, field)]);
      }
    }
  }
  return out;
}

const quote = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\s+/g, " ")}"`;

/**
 * The checks@1 pack for a template, or undefined when it declares no checks. The rules are fixed; the generated part
 * is one message per check, so a finding states the requirement it misses.
 */
export function checksPack(t: Pick<Template, "kinds" | "rootChecks">): RulePack | undefined {
  const checks = checksOf(t);
  if (!checks.length) return undefined;
  const messages = checks.map(({ rule, check }) => (isDeterministic(check)
    ? `.message ${quote(rule)} ${quote(`{1} does not meet a ${rule.slice(CHECK_PREFIX.length).split(".")[0]} check: ${check.text}`)}`
    : `.message ${quote(rule)} ${quote(`{1} may not meet a ${rule.slice(CHECK_PREFIX.length).split(".")[0]} check: ${check.text}`)}`));
  return { id: "checks", version: "1", source: `
% checks@1 - the template's checklist. Which nodes a check applies to and whether a pattern matches are computed by
% toFacts (see checkFacts); a semantic check becomes a candidate the catalogue's check:<kind>.<id> question judges,
% a deterministic one a violation at the check's level.
.decl checkCandidate(Rule: sym, Subject: sym, Text: sym)
.decl checkMiss(Rule: sym, Subject: sym, Severity: sym)
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

${messages.join("\n")}

semanticCandidate(R,S,T) :- checkCandidate(R,S,T).
violation(R,S,V) :- checkMiss(R,S,V).
` };
}
