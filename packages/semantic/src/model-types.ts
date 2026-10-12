// TODO: switch these to imports from `@artyfact/model` once that package exports them.
// Minimal structural types, matching the shapes in docs/design/semantic.md.

export interface Commitment {
  id: string;
  statement: string;
}

export interface OntologyNode {
  id: string;
  kind: string;
  name: string;
  effects?: unknown;
  fields?: Record<string, unknown>;
}

export interface TheoryClaim {
  id: string;
  mechanism: string;
  outcome: string;
  indicator: string;
  evaluationMethod?: string;
  limitation?: string;
}

/** What the System's accepted contract currently says: used as `governing` in E.1. */
export interface Governing {
  criteria: unknown[];
  requirements: unknown[];
}

export interface SemanticChange {
  id: string;
  kind: string;
  before: unknown;
  after: unknown;
  fieldsChanged: string[];
}

export interface SemanticDelta {
  changes: SemanticChange[];
}

/** The slice of the model that reviewDelta needs. */
export interface SemanticModel {
  system: { id: string; purpose: string };
  governing: Governing;
}

export interface EvolutionSummary {
  evolution: string;
  changedSubjects: string[];
  summary: string;
}

export const PRIVATE_PAIRS_PROFILE =
  'private-pairs: exactly one recipient per outgoing direct action; no recipient lists, bulk send or group threads';
