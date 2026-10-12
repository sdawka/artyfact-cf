export * as schema from "./schema.ts";
export { loadSystem, ModelParseError, templateRef, THING_PLACEHOLDER, SYSTEM_PLACEHOLDER } from "./load.ts";
export type { SystemModel, TemplateStore, ParseIssue, ModelWarning } from "./load.ts";
export { index } from "./model-index.ts";
export type { ModelIndex, IndexEntry, EntryType, LinkRef } from "./model-index.ts";
export { toFacts, RELATIONS, stepKey } from "./facts.ts";
export type { RelationName } from "./facts.ts";
export { validate } from "./validate.ts";
export type { Finding, Readiness, RulePack } from "./validate.ts";
export type { DerivationTree, FactSet, Tuple, Value } from "@artyfact/rules";
export { diffModels, overlap } from "./diff.ts";
export type { SemanticDelta } from "./diff.ts";
export { toMermaid } from "./mermaid.ts";
export { PhenomeEventHeader, PHENOME_LIMITS } from "./phenome.ts";
export { composeParts, extractPart, upgradeComposition, partDigest, PartCompositionError } from "./parts.ts";
export type { PartResolver, ComposeOptions } from "./parts.ts";
export type {
  PartRef, PartPackage, PartRecipe, PartContribution, PartUse, PartCommand, SavedPartCommand,
  PartPayload, PartInputDefinition, PartInputValue, PartSelection, PartMask, PartReplacement,
  PartCombination, PartOutputMapping, CompositionProvenance, SavedComposition, ExtractionRequest,
  ExtractionResult, UpgradeRequest, UpgradeConflict, UpgradeResult,
} from "./schema.ts";
