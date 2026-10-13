import type { WorldSnapshot } from "./contracts.ts";
import type { Finding } from "../../evaluate/findings.ts";
import type { Readiness } from "../../evaluate/evaluate.ts";
import type { Tuple } from "@artyfact/rules";
import { rustRuleOf, SCOPE_RULE, TYPED_REFERENCES } from "./template.ts";

/** A finding in world-core's terms: rule id, severity and object ids. */
export interface WorldFinding { ruleId: string; severity: "blocker" | "unknown"; objectIds: string[] }
export type WorldStatus = "ready" | "blocked" | "unknown";

/** Rust codes whose findings carry no object ids. */
const NO_OBJECTS = new Set([
  "core.ids-unique", "core.shape-ids-unique", "core.thing-template-definitions-unique", "core.rule-packs-pinned",
  "core.compiled-rule-packs", "core.required-rule-packs", "core.completeness-declarations-unique", SCOPE_RULE,
]);
const TYPED = new Set<string>(TYPED_REFERENCES.map(([rel]) => rel));
const ADAPTER_LINKS = new Set(["ws.ofThing", "ws.usesTemplate"]);
const THING = "ws:thing:";

const leaf = (f: Finding, rel: string): Tuple | undefined => f.facts.find((t) => t[0] === rel);
const strip = (id: string) => (id.startsWith(THING) ? id.slice(THING.length) : id);

/**
 * The Rust codes and object ids an engine finding stands for; empty when world-core has no counterpart.
 * Findings of `world.readiness@1` already carry Rust codes. Core findings map by rule id and their EDB leaves.
 */
export function rustCodesOf(f: Finding, snapshot: WorldSnapshot): { ruleId: string; objectIds: string[] }[] {
  const s = f.subject ?? "";
  const one = (ruleId: string, objectIds: string[]) => [{ ruleId, objectIds }];
  if (f.pack === "world.readiness@1") {
    if (f.rule === "core.relation-endpoints-legal") {
      const l = leaf(f, "link");
      return one(f.rule, l ? [String(l[1]), String(l[3])] : [s]);
    }
    if (f.rule === "core.world-references-pinned" || f.rule === "core.world-root") return one(f.rule, [snapshot.worldId]);
    // An incompatible pair is a World-level finding; its subject is the ws:activeConstraints node.
    if (leaf(f, "incompatible")) return one(rustRuleOf(f.rule), []);
    return one(rustRuleOf(f.rule), NO_OBJECTS.has(f.rule) ? [] : [strip(s)]);
  }
  switch (f.rule) {
    case "node.kindUnknown": return one("core.shape-known", [s]);
    case "node.duplicate": return one("core.ids-unique", []);
    case "field.required": return one("core.shape-required-properties", [s]);
    case "ref.parentMissing": return one("core.references-resolve", [s]);
    case "link.sourceUnknown": return one("core.references-resolve", [s]);
    case "scope.undeclared": return one(SCOPE_RULE, []);
    case "ref.dangling": {
      const r = leaf(f, "ref");
      if (!r) return [];
      const [, from, via, to] = r.map(String);
      if (via === "ws.ofThing") return one("core.references-resolve", [from]);
      if (via === "ws.usesTemplate") return one("core.thing-template-resolves", [strip(from)]);
      return one("core.references-resolve", [to]);
    }
    case "link.endpoint":
    case "link.relationUnknown": {
      const l = leaf(f, "link");
      if (!l) return [];
      const [, from, rel, to] = l.map(String);
      if (TYPED.has(rel)) return one("core.typed-references", [to]);
      if (ADAPTER_LINKS.has(rel)) return [];
      return one("core.relation-endpoints-legal", [from, to]);
    }
    case "relation.required": {
      const r = leaf(f, "requiredRel");
      if (!r) return [];
      const [, kind, rel] = r.map(String);
      return snapshot.template.requiredRelations
        .filter((q) => q.subjectKind === kind && q.relationKind === rel)
        .map((q) => ({ ruleId: q.ruleId, objectIds: [s] }));
    }
    case "cycle.forbidden": {
      const c = leaf(f, "forbiddenCycle");
      return c ? one(rustRuleOf(String(c[1])), [s]) : [];
    }
    case "constraint.incompatible": {
      const c = leaf(f, "incompatible");
      return c ? one(rustRuleOf(String(c[1])), []) : [];
    }
    default: return [];
  }
}

const key = (f: { ruleId: string; objectIds: string[] }) => JSON.stringify([f.ruleId, f.objectIds]);

/**
 * Engine findings in world-core's terms, one per (rule id, object ids), sorted. Severity is `blocker` when any
 * engine finding behind the key is an `error`, else `unknown`. `unmapped` lists findings world-core has no code for.
 */
export function toWorldFindings(readiness: Readiness, snapshot: WorldSnapshot): { findings: WorldFinding[]; unmapped: Finding[] } {
  const byKey = new Map<string, WorldFinding>();
  const unmapped: Finding[] = [];
  for (const f of readiness.findings) {
    const codes = rustCodesOf(f, snapshot);
    if (!codes.length) unmapped.push(f);
    for (const c of codes) {
      const prev = byKey.get(key(c));
      const severity = f.level === "error" || prev?.severity === "blocker" ? "blocker" : "unknown";
      byKey.set(key(c), { ...c, severity });
    }
  }
  const findings = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
  return { findings, unmapped };
}

/**
 * world-core's `ReadinessStatus` from engine flags: `blocked` when any finding is an `error`, `ready` when the
 * readiness is `actionable`, otherwise `unknown` (a `missing` finding, or an evaluation that hit its iteration bound).
 */
export const worldStatus = (r: Readiness): WorldStatus =>
  r.findings.some((f) => f.level === "error") ? "blocked" : r.actionable ? "ready" : "unknown";
