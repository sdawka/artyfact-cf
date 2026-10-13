import { hashOf } from "../canon.ts";
import { EDB_RELATIONS, edbProgram, FORM_DECLS, TEMPLATE_DECLS } from "../evaluate/edb.ts";
import { templateFacts, type Facts } from "../evaluate/facts.ts";
import { compilePattern } from "../evaluate/text.ts";
import { CHECK_LEVELS, type TextConstraints } from "./schema.ts";
import { fold, FINDING_LEVELS, type Finding } from "../evaluate/findings.ts";
import { meta } from "../evaluate/packs/meta.ts";
import { factSet, parse, run, stratify, RuleParseError, StratificationError, type Program, type Tuple } from "@artyfact/rules";
import { resolveLineage, type Template, type TemplateStore } from "./template.ts";
import { DEFECTS, otherKindDefects } from "../judge/defects.ts";
import { checkScope, checksOf, ROOT_OWNER } from "../evaluate/checks.ts";

export interface TemplateForm { valid: boolean; findings: Finding[]; hash: string }

export class TemplateFormError extends Error {
  templateHash: string;
  findings: Finding[];
  constructor(templateHash: string, findings: Finding[]) {
    const first = findings.find((f) => f.level === "error");
    super(`template ${templateHash} is not a valid template: ${first ? `${first.rule} on ${first.subject}` : "evaluation incomplete"}`);
    this.name = "TemplateFormError";
    this.templateHash = templateHash;
    this.findings = findings;
  }
  get rule(): string | undefined { return this.findings.find((f) => f.level === "error")?.rule; }
}

export const packName = (p: { id: string; version: string }): string => `${p.id}@${p.version}`;

function packFacts(t: Template): Record<string, Tuple[]> {
  const out: Record<string, Tuple[]> = { packError: [], packRead: [], packDerives: [] };
  const programs: Program[] = [];
  const fail = (pack: string, e: unknown) => {
    if (e instanceof StratificationError) out.packError.push([pack, "stratify", e.message]);
    else if (e instanceof RuleParseError) out.packError.push([e.file === "edb" ? pack : e.file, "parse", e.message]);
    else throw e;
  };
  for (const p of t.rules) {
    const name = packName(p);
    let prog: Program;
    try { prog = parse(p.source, name); } catch (e) { fail(name, e); continue; }
    programs.push(prog);
    for (const r of prog.rules) {
      out.packDerives.push([r.head.rel]);
      for (const l of r.body) {
        const rel = l.kind === "atom" ? l.rel : l.kind === "count" ? l.atom.rel : undefined;
        if (rel) out.packRead.push([`${name}:${rel}`, name, rel]);
      }
    }
  }
  try { stratify([edbProgram(), ...programs]); } catch (e) { fail(t.ref, e); }
  return out;
}

/** Declared text constraints as written, per kind field and for `textDefaults` (scope: the template ref, field `*`). */
function textDeclFacts(t: Template): Facts {
  const out: Facts = { textBound: [], textPatternInvalid: [], textDistinctDecl: [], textDefaultDistinct: [] };
  const add = (scope: string, field: string, c: TextConstraints) => {
    for (const key of ["minLength", "minWords"] as const) if (c[key] !== undefined) out.textBound.push([scope, field, key, c[key]]);
    if (c.pattern !== undefined && !compilePattern(c.pattern)) out.textPatternInvalid.push([scope, field]);
  };
  for (const [k, kind] of Object.entries(t.kinds)) for (const fd of kind.fields) {
    add(k, fd.name, fd);
    for (const o of fd.distinctFrom ?? []) out.textDistinctDecl.push([k, fd.name, o]);
  }
  if (t.textDefaults) {
    add(t.ref, "*", t.textDefaults);
    for (const o of t.textDefaults.distinctFrom ?? []) out.textDefaultDistinct.push([t.ref, o]);
  }
  return out;
}

/** Longest criterion sentence before meta@1 warns; it is sent in a question stem whose criteria are capped alike. */
export const CRITERION_MAX = 255;

/** Kind and root criteria as written: tangibility boundaries, and sentences longer than `CRITERION_MAX`. */
function criteriaDeclFacts(t: Template): Facts {
  const out: Facts = { criterionMinScore: [], criterionTooLong: [] };
  const long = (scope: string, c: Record<string, unknown>) => {
    for (const [key, v] of Object.entries(c)) if (typeof v === "string" && v.length > CRITERION_MAX) out.criterionTooLong.push([scope, key]);
  };
  for (const [k, kind] of Object.entries(t.kinds)) {
    if (!kind.criteria) continue;
    if (kind.criteria.minScore !== undefined) out.criterionMinScore.push([k, kind.criteria.minScore]);
    long(k, kind.criteria);
  }
  if (t.rootCriteria) long(t.ref, t.rootCriteria);
  return out;
}

/**
 * The checklist as written, by rule id (`check:<owner>.<id>`): ids repeated within one owner, the defect each stands
 * for, `when.field` with the kind that must declare it (`*`: any kind, for root, children and pair checks), patterns
 * that do not compile, and levels other than error, warning and info.
 */
function checkDeclFacts(t: Template): Facts {
  const out: Facts = { checkIdDuplicate: [], checkDefect: [], checkWhenField: [], checkPatternInvalid: [], checkLevelUnknown: [] };
  const seen = new Set<string>();
  for (const { owner, rule, check } of checksOf(t)) {
    if (seen.has(rule)) out.checkIdDuplicate.push([rule]);
    seen.add(rule);
    out.checkDefect.push([rule, check.defect ?? (checkScope(check) === "node" ? "instance" : "consistency")]);
    if (check.when?.field !== undefined) out.checkWhenField.push([rule, owner !== ROOT_OWNER && checkScope(check) === "node" ? owner : "*", check.when.field]);
    if ([check.pattern, check.when?.pattern].some((p) => p !== undefined && !compilePattern(p))) out.checkPatternInvalid.push([rule]);
    if (check.level !== undefined && !(CHECK_LEVELS as readonly string[]).includes(check.level)) out.checkLevelUnknown.push([rule, check.level]);
  }
  return out;
}

/** Questions on a `next` cycle (a self-loop included); asks naming no declared question are ignored here. */
export function nextCycles(questions: Template["questions"]): string[] {
  const out = new Map(questions.map((q) => [q.id, [...new Set((q.next ?? []).map((n) => n.ask))]]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cyclic = new Set<string>();
  let counter = 0;
  // Tarjan's strongly connected components, iterative so deep chains cannot overflow the call stack.
  for (const root of out.keys()) {
    if (index.has(root)) continue;
    const work: [string, number][] = [[root, 0]];
    index.set(root, counter); low.set(root, counter++); stack.push(root); onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1]!;
      const [v, i] = top;
      const succ = (out.get(v) ?? []).filter((w) => out.has(w));
      if (i < succ.length) {
        top[1]++;
        const w = succ[i]!;
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter++); stack.push(w); onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) { const u = work[work.length - 1]![0]; low.set(u, Math.min(low.get(u)!, low.get(v)!)); }
      if (low.get(v) === index.get(v)) {
        const scc: string[] = [];
        for (let w = stack.pop()!; ; w = stack.pop()!) { onStack.delete(w); scc.push(w); if (w === v) break; }
        if (scc.length > 1 || succ.includes(v)) for (const w of scc) cyclic.add(w);
      }
    }
  }
  return [...cyclic].sort();
}

/**
 * Whether a question's benign answer is one it can give: yes or no for yes-no, an integer level index (within
 * `choices` when declared) for score, a declared choice for choice (any value when options are resolved per subject).
 */
export function benignValid(q: Template["questions"][number]): boolean {
  const b = q.benign;
  if (q.answer === "yes-no") return b === true || b === false || b === "yes" || b === "no";
  if (q.answer === "score") {
    const n = typeof b === "number" ? b : typeof b === "string" && b.trim() !== "" ? Number(b) : NaN;
    return Number.isInteger(n) && n >= 0 && (!q.choices?.length || n < q.choices.length);
  }
  return q.choicesFrom !== undefined || (q.choices ?? []).includes(String(b));
}

/** Defect references as written: own and policy defects, overrides, and the ids they may name. */
function defectDeclFacts(t: Template): Facts {
  const known = [...DEFECTS, ...otherKindDefects(Object.keys(t.kinds))].map((d) => [d.id]);
  return {
    defectKnown: known,
    defectDisable: (t.defects?.disable ?? []).map((d) => [d]),
    defectLevelDecl: Object.entries(t.defects?.levels ?? {}).map(([d, l]) => [d, l]),
    questionOwnDefect: t.questions.flatMap((q) => (q.defect ? [[q.id, q.defect]] : [])),
    questionPolicyDefect: t.questions.flatMap((q) => q.policy.flatMap((p) => (p.defect ? [[q.id, String(p.answer), p.defect]] : []))),
    questionNextCycle: nextCycles(t.questions).map((q) => [q]),
    questionBatch: t.questions.flatMap((q) => (q.batchWith ?? []).map((b) => [q.id, b])),
    questionByKind: t.questions.flatMap((q) => Object.keys(q.byKind ?? {}).map((k) => [q.id, k])),
    questionPassFrom: t.questions.flatMap((q) => Object.keys(q.passFrom ?? {}).map((k) => [q.id, k])),
    questionChoice: t.questions.flatMap((q) => (q.choices ?? []).map((c) => [q.id, c])),
    questionCriterionKey: t.questions.flatMap((q) => Object.keys(q.criteria ?? {}).map((c) => [q.id, c])),
    questionOption: t.questions.flatMap((q) => (q.answer === "choice" ? (q.choices ?? []).map((c) => [q.id, c]) : [])),
    questionBenignInvalid: t.questions.filter((q) => !benignValid(q)).map((q) => [q.id]),
  };
}

/** Template set plus the meta-level facts meta@1 reads. */
export function formFacts(t: Template, store?: TemplateStore): Facts {
  const edges = store ? resolveLineage(t.ref, t.extends, store) : { edges: t.edges, ancestors: [] };
  const known = store ? [t.ref, ...edges.ancestors.map((a) => `${a.id}@${a.version}`)] : t.lineage;
  return {
    ...templateFacts(t),
    extends: edges.edges,
    templateKnown: known.map((r) => [r]),
    templateNode: t.nodes.map((n) => [n.id, n.kind]),
    templateNodeLink: t.nodes.flatMap((n) => (n.links ?? []).map((l) => [n.id, l.rel])),
    questionPolicy: t.questions.flatMap((q) => q.policy.map((p) => [q.id, String(p.answer), p.level])),
    questionSliceKind: t.questions.flatMap((q) => [...new Set([...(q.slice.kinds ?? []), ...(q.slice.anchors ?? [])])].map((k) => [q.id, k])),
    questionSliceRel: t.questions.flatMap((q) => (q.slice.rels ?? []).map((r) => [q.id, r])),
    findingLevel: FINDING_LEVELS.map((l) => [l]),
    edbRelation: EDB_RELATIONS.map((r) => [r]),
    ...textDeclFacts(t),
    ...criteriaDeclFacts(t),
    ...checkDeclFacts(t),
    ...defectDeclFacts(t),
    ...packFacts(t),
  };
}

const metaName = packName(meta);
const metaPrograms = () => [parse(TEMPLATE_DECLS + FORM_DECLS, "form-edb"), parse(meta.source, metaName)];

/** Runs meta@1 over the template. With `store`, `extends` is re-resolved; otherwise the lineage recorded at load is used. */
export function checkTemplateForm(t: Template, store?: TemplateStore): TemplateForm {
  const result = run(factSet(formFacts(t, store)), metaPrograms());
  const findings = fold(result, [metaName]);
  return { valid: !result.incomplete && !findings.some((f) => f.level === "error"), findings, hash: t.hash };
}

const cache = new Map<string, TemplateForm>();
const CACHE_LIMIT = 64;

/** Form check cached by template hash. */
export function cachedForm(t: Template): TemplateForm {
  const key = hashOf([t.hash, metaName, meta.source]);
  let form = cache.get(key);
  if (!form) {
    form = checkTemplateForm(t);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, form);
  }
  return form;
}
