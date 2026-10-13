import { ARTYFACT_GENOME } from "./adapters/artyfact/graph.ts";
import type { TemplateInput } from "./meta/schema.ts";
import type { Graph } from "./graph/graph.ts";

export const OUTCOMES_TEMPLATE = "template.meta.outcomes@1";
/** Opt-in vocabulary. Domain packages can extend this instead of the base template. */
export const outcomesTemplate: TemplateInput = {
  id: "template.meta.outcomes", version: 1, meta: 1, extends: ARTYFACT_GENOME,
  kinds: {
    eventContract: { fields: [{ name: "name", type: "string" }, { name: "version", type: "number", required: true }, { name: "payloadFields", type: "list", required: true }], parents: ["system", "thing", "section"] },
    expectedEffect: { fields: [{ name: "name", type: "string" }, { name: "description", type: "string", required: true }], parents: ["system", "thing", "section"] },
    outcomeAssay: { fields: [{ name: "name", type: "string" }, { name: "description", type: "string", required: true }], parents: ["system", "thing", "section"] },
  },
  relations: {
    evidenceFor: { from: ["eventContract"], to: ["expectedEffect"] },
    testsEffect: { from: ["outcomeAssay"], to: ["expectedEffect"] },
    observesEvent: { from: ["outcomeAssay"], to: ["eventContract"] },
  },
};
export interface OutcomePayloadField { name: string; type: "string" | "number" | "boolean" | "object" | "array"; required?: boolean }
export interface OutcomeEventContract { id: string; version: number; fields: OutcomePayloadField[] }
export interface OutcomeEventInput { contractId: string; version: number; payload: unknown }
export interface OutcomeValidation { valid: boolean; issues: { path: string; message: string }[] }

/** Invalid contracts fail closed; validation never infers an effect from the event. */
export function validateOutcomeEvent(contracts: readonly OutcomeEventContract[], event: OutcomeEventInput): OutcomeValidation {
  const issues: OutcomeValidation["issues"] = [];
  const matches = contracts.filter(c => c.id === event.contractId && c.version === event.version);
  if (matches.length !== 1) return { valid: false, issues: [{ path: "contractId", message: "unknown or ambiguous event contract version" }] };
  if (!event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) return { valid: false, issues: [{ path: "payload", message: "expected payload object" }] };
  const payload = event.payload as Record<string, unknown>;
  const contract = matches[0]!;
  if (!Array.isArray(contract.fields) || contract.fields.length > 100 || !Number.isInteger(contract.version) || contract.version < 1)
    return { valid: false, issues: [{ path: "contract", message: "invalid event contract" }] };
  const names = new Set<string>();
  for (const field of contract.fields) {
    if (!field || typeof field.name !== "string" || !field.name || names.has(field.name) || !["string", "number", "boolean", "object", "array"].includes(field.type)) {
      issues.push({ path: "contract", message: "invalid or duplicate payload field" }); continue;
    }
    names.add(field.name);
    const value = payload[field.name];
    if (value === undefined) { if (field.required) issues.push({ path: `payload.${field.name}`, message: "required field missing" }); continue; }
    const valid = field.type === "array" ? Array.isArray(value) : field.type === "object" ? !!value && typeof value === "object" && !Array.isArray(value)
      : field.type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === field.type;
    if (!valid) issues.push({ path: `payload.${field.name}`, message: `expected ${field.type}` });
  }
  for (const key of Object.keys(payload)) if (!names.has(key)) issues.push({ path: `payload.${key}`, message: "undeclared event payload field" });
  return { valid: issues.length === 0, issues };
}
export function outcomeEventContracts(graph: Graph): OutcomeEventContract[] {
  return graph.nodes.filter(n => n.kind === "eventContract").map(n => ({ id: n.id, version: n.fields.version as number, fields: n.fields.payloadFields as OutcomePayloadField[] }));
}
