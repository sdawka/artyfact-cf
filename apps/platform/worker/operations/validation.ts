import { z } from "zod";
import type { CustomMeasurementPayload, FlagCondition, FlagConditionGroup, FlagDefinition, OperationsWindow } from "../../shared/operations";
import { badRequest } from "../errors";

export const operationId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const primitive = z.union([z.string(), z.number().finite(), z.boolean()]);
const value = z.union([primitive, z.record(z.string(), z.unknown()), z.array(z.unknown())]);
const comparison = z.object({ attribute: z.string().min(1).max(64), operator: z.enum(["equals", "not_equals", "contains", "starts_with", "ends_with", "in", "not_in", "greater_than", "less_than", "greater_than_or_equals", "less_than_or_equals", "has", "not_has"]), value }).strict();
const conditionAt = (depth: number): z.ZodType<FlagCondition> => depth > 5 ? comparison : z.union([comparison, z.object({ logical_operator: z.enum(["AND", "OR"]), clauses: z.array(z.lazy(() => conditionAt(depth + 1))).min(1).max(100) }).strict()]);
const condition = conditionAt(0);
const group = z.object({ logical_operator: z.enum(["AND", "OR"]), clauses: z.array(condition).min(1).max(100) }).strict() satisfies z.ZodType<FlagConditionGroup>;
const rule = z.object({ conditions: z.union([z.array(condition).max(100), group]), priority: z.number().int().min(1), serve_variation: z.string().min(1).max(64), rollout: z.object({ percentage: z.number().finite().min(0).max(100).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8, "percentage needs at most two decimal places"), attribute: z.string().min(1).max(64).optional() }).strict().optional() }).strict();
export const flagSchema = z.object({ key: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/), enabled: z.boolean(), default_variation: z.string().min(1).max(64), variations: z.record(z.string().min(1).max(64), z.union([primitive, z.record(z.string(), z.unknown()), z.array(z.unknown())])), rules: z.array(rule).max(100), description: z.string().max(512).optional() }).strict();
export function validateFlag(raw: unknown): FlagDefinition {
  let bytes: number; try { bytes = new TextEncoder().encode(JSON.stringify(raw)).length; } catch { throw badRequest("flag must be JSON"); }
  if (bytes > 262_144) throw badRequest("flag exceeds 256KB");
  const parsed = flagSchema.safeParse(raw);
  if (!parsed.success) throw badRequest(`invalid flag: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const f = parsed.data;
  const entries = Object.entries(f.variations);
  if (!entries.length || !Object.hasOwn(f.variations, f.default_variation) || f.rules.some(r => !Object.hasOwn(f.variations, r.serve_variation))) throw badRequest("default and served variation must exist");
  const typeOf = (v: unknown) => typeof v === "object" ? "json" : typeof v;
  if (new Set(entries.map(([,v]) => typeOf(v))).size !== 1) throw badRequest("variations must share a value type");
  for (const [, v] of entries) { let text: string; try { text = JSON.stringify(v); } catch { throw badRequest("variation must be JSON"); } if (new TextEncoder().encode(text).length > 10_240) throw badRequest("variation exceeds 10KB"); }
  if (new Set(f.rules.map(r => r.priority)).size !== f.rules.length) throw badRequest("rule priorities must be unique");
  return f;
}
const measurement = z.object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/), value: z.number().finite(), unit: z.string().min(1).max(32).optional() }).strict();
export function validateMeasurement(raw: unknown): CustomMeasurementPayload {
  const parsed = measurement.safeParse(raw);
  if (!parsed.success) throw badRequest("measurement payload must contain name, finite numeric value and optional unit");
  return parsed.data;
}
export function parseWindow(from?: string, to?: string, now = Date.now()): OperationsWindow {
  const end = to === undefined ? now : Date.parse(to), start = from === undefined ? end - 86_400_000 : Date.parse(from);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end > now) throw badRequest("window must have valid ordered timestamps ending no later than now");
  if (end - start > 7 * 86_400_000) throw badRequest("window cannot exceed 7 days");
  return { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
}
