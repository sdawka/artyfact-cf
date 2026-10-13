export { canon, hashOf } from "./canon.ts";
export { parseCardinality, type Cardinality } from "./meta/cardinality.ts";
export * from "./meta/schema.ts";
export {
  emptyStore, instantiateNodes, loadTemplate, memoryStore, mergeChecks, refOf, resolveLineage, templateHash,
  type Template, type TemplateStore,
} from "./meta/template.ts";
export { cachedForm, checkTemplateForm, formFacts, nextCycles, packName, TemplateFormError, type TemplateForm } from "./meta/form.ts";
export * from "./graph/graph.ts";
export { EDB_DECLS, EDB_RELATIONS, FORM_DECLS, GRAPH_DECLS, TEMPLATE_DECLS } from "./evaluate/edb.ts";
export { graphFacts, templateFacts, toFacts, type Facts } from "./evaluate/facts.ts";
export { FINDING_LEVELS, type Finding, type Level } from "./evaluate/findings.ts";
export { CORE_PACKS, evaluate, type EvaluateOptions, type Readiness } from "./evaluate/evaluate.ts";
export { diff, diffFindings, type GraphDelta } from "./evaluate/diff.ts";
export { completeness, consistency, meta, metamodel, text } from "./evaluate/packs/index.ts";
export {
  CHECK_PREFIX, checkFacts, checkRule, checksOf, checksPack, DEFAULT_CHECK_FIELD, fieldText, ROOT_OWNER, type OwnedCheck,
} from "./evaluate/checks.ts";
export { compilePattern, isPlaceholder, kindTextConstraints, normaliseText, textLength, textWords } from "./evaluate/text.ts";
export * from "./judge/index.ts";
export * from "./adapters/artyfact/index.ts";
export * from "./route/index.ts";
