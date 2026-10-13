import type { schema } from "@artyfact/model";
import type { PartRecord, PartScope, PartSummary } from "../../shared/api";
import { fromRpc } from "../errors";
import { registryStub } from "../service";

async function rpc<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw fromRpc(error) ?? error;
  }
}

export const listParts = (env: Env, scope: PartScope): Promise<PartSummary[]> => rpc(registryStub(env).listParts(scope));
export const getPart = (env: Env, scope: PartScope, partId: string, version: string): Promise<PartRecord | null> =>
  rpc(registryStub(env).getPart(scope, partId, version));
export const publishPart = (env: Env, scope: PartScope, pkg: schema.PartPackage): Promise<PartRecord> =>
  rpc(registryStub(env).publishPart(scope, pkg));
