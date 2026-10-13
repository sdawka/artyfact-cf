/** Operational controls are independent of Genome Evolutions and implementation promotion. */
export interface OperationsWindow { from: string; to: string }
export type OperationsState = "available" | "unavailable" | "retention-exceeded" | "partial";
export interface OperationsScope { systemId: string; bindingId: string; environment: string }
export interface OperationsStatus { state: OperationsState; reason?: string; fetchedAt: string }
export interface RuntimeMetricsResponse extends OperationsStatus, OperationsScope {
  window: OperationsWindow;
  retentionDays: number;
  provider: "cloudflare-workers-graphql";
  /** Script aggregates span versions; analytics does not prove an output's lineage. */
  lineage: null;
  requests: number | null;
  invocationErrors: number | null;
  cpu: { unit: "microseconds"; p50: number | null; p99: number | null };
  sampled: true;
}
export interface CustomMeasurementPayload { name: string; value: number; unit?: string }
/** Emitted through existing authenticated POST phenome/events with kind='measurement'. */
export interface CustomMeasurement extends CustomMeasurementPayload {
  emittedAt: string; receivedAt: string; seq: number; thingId: string; artifactId: string;
  buildId: string; commit: string; outputId?: string; genomeCommit?: string; deploymentId?: string;
}
export interface MeasurementsResponse extends OperationsStatus, OperationsScope {
  window: OperationsWindow; measurements: CustomMeasurement[];
  retention: { rowCap: number; kind: "system-row-cap" };
  nextBefore?: number;
}
export type FlagValue = boolean | string | number | Record<string, unknown> | unknown[];
export type FlagOperator = "equals" | "not_equals" | "contains" | "starts_with" | "ends_with" | "in" | "not_in" | "greater_than" | "less_than" | "greater_than_or_equals" | "less_than_or_equals" | "has" | "not_has";
export interface FlagComparison { attribute: string; operator: FlagOperator; value: FlagValue }
export interface FlagConditionGroup { logical_operator: "AND" | "OR"; clauses: FlagCondition[] }
export type FlagCondition = FlagComparison | FlagConditionGroup;
export interface FlagRule { conditions: FlagCondition[] | FlagConditionGroup; priority: number; serve_variation: string; rollout?: { percentage: number; attribute?: string } }
export interface FlagDefinition {
  key: string; enabled: boolean; default_variation: string; variations: Record<string, FlagValue>; rules: FlagRule[]; description?: string;
}
export interface OperationalFlag extends FlagDefinition { version: string; type?: "boolean" | "string" | "number" | "json"; updatedAt?: string }
export interface FlagsResponse extends OperationsStatus, OperationsScope { flags: OperationalFlag[]; nextCursor?: string }
export interface FlagResponse extends OperationsStatus, OperationsScope { flag: OperationalFlag | null }
export interface CreateFlagRequest { flag: FlagDefinition; reason: string }
export interface UpdateFlagRequest { expectedVersion: string; patch: Partial<Omit<FlagDefinition, "key">>; reason: string }
export interface OperationAuditEntry extends OperationsScope {
  id: string; at: string; actor: "admin"; operation: "flag.create" | "flag.update" | "flag.disable";
  key: string; reason: string; beforeVersion: string | null; afterVersion: string | null;
  status: "pending" | "applied" | "failed" | "conflict" | "unknown";
}
export interface OperationsAuditResponse { entries: OperationAuditEntry[] }
export interface OperationsBindingsResponse { bindings: { bindingId: string; configured: boolean; environment?: string }[] }
const base = (s: string, b: string) => `/api/systems/${encodeURIComponent(s)}/operations/bindings/${encodeURIComponent(b)}`;
export const operationsPaths = {
  bindings: (s: string) => `/api/systems/${encodeURIComponent(s)}/operations/bindings`,
  metrics: (s: string, b: string) => `${base(s,b)}/metrics`,
  measurements: (s: string, b: string) => `${base(s,b)}/measurements`,
  flags: (s: string, b: string) => `${base(s,b)}/flags`,
  flag: (s: string, b: string, key: string) => `${base(s,b)}/flags/${encodeURIComponent(key)}`,
  audit: (s: string, b: string) => `${base(s,b)}/audit`,
};
