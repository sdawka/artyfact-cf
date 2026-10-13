import { z } from "zod";
import { badRequest, notFound } from "../errors";
import { registryStub, systemStub } from "../service";
import { operationId } from "./validation";

const bindingSchema = z.object({ accountId: z.string().regex(/^[a-f0-9]{32}$/), scriptName: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/), environment: operationId, flagshipAppId: operationId.optional(), metricsRetentionDays: z.number().int().min(1).max(90).default(1) }).strict();
export type OperationsBinding = z.infer<typeof bindingSchema>;
export type OperationsEnv = Env & { OPERATIONS_BINDINGS?: unknown; OPERATIONS_API_TOKEN?: string };
export function configuredBindings(value: unknown): Record<string, Record<string, OperationsBinding>> {
  let raw = value;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return {}; } }
  const parsed = z.record(operationId, z.record(operationId, bindingSchema)).safeParse(raw);
  return parsed.success ? parsed.data : {};
}
export async function bindingScope(env: OperationsEnv, systemId: string, bindingId?: string) {
  if (!operationId.safeParse(systemId).success || (bindingId !== undefined && !operationId.safeParse(bindingId).success)) throw badRequest("invalid System or binding ID");
  if (!(await registryStub(env).hasSystem(systemId))) throw notFound(`system ${systemId} is not imported`);
  const stub = systemStub(env, systemId), state = await stub.state();
  if (!state) throw notFound(`system ${systemId} is not imported`);
  const artifacts = state.manifest?.artifacts ?? {};
  if (bindingId !== undefined && !Object.hasOwn(artifacts, bindingId)) throw notFound(`binding ${bindingId} is not in the System manifest`);
  const configs = configuredBindings(env.OPERATIONS_BINDINGS)[systemId] ?? {};
  return { stub, artifacts, config: bindingId === undefined ? undefined : configs[bindingId], configs };
}
