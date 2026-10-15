import type { schema } from "@artyfact/model";
import type { PartRecord, PartScope, PartSummary } from "../../shared/api";
import { rpc } from "../errors";
import { registryStub } from "../service";

export const listParts = (env: Env, scope: PartScope): Promise<PartSummary[]> => rpc(registryStub(env).listParts(scope));
export const getPart = (env: Env, scope: PartScope, partId: string, version: string): Promise<PartRecord | null> =>
  rpc(registryStub(env).getPart(scope, partId, version));
export const publishPart = (env: Env, scope: PartScope, pkg: schema.PartPackage): Promise<PartRecord> =>
  rpc(registryStub(env).publishPart(scope, pkg));
