import { Hono } from "hono";
import { isOntologySystemId } from "../ontology-packages/store";
import { requireAdmin } from "../auth";
import { badRequest, HttpError, notFound, rpc } from "../errors";
import { systemStub } from "../service";
import type { CreateInitialSystemRequest, OntologyImportPreviewRequest } from "../../shared/ontology-packages";
import { type AppEnv, type Ctx } from "./app";

/** Bounded streaming parse also caps bodies without a Content-Length header. */
async function boundedBody(c: Ctx): Promise<Record<string, unknown>> {
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const r = await reader.read(); if (r.done) break;
    size += r.value.length;
    if (size > 1_300_000) { await reader.cancel(); throw new HttpError(413, "import-too-large", "import request exceeds size limit"); }
    chunks.push(r.value);
  }
  try {
    const data = JSON.parse(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).text());
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw badRequest("body must be a JSON object"); }
}
function systemId(value: unknown): string {
  if (!isOntologySystemId(value)) throw badRequest("invalid or reserved System id");
  return value;
}
async function destination(c: Ctx) {
  const id = systemId(c.req.param("id"));
  const stub = systemStub(c.env, id);
  if (!(await stub.ontologyInitial()) && !(await stub.state())) throw notFound("System import destination not found");
  return { id, stub };
}

/** All private package sources and invalid conversion output require the existing admin authorization. */
export const ontologyPackages = new Hono<AppEnv>()
  .post("/systems/initial", requireAdmin, async c => {
    const input = await boundedBody(c) as unknown as CreateInitialSystemRequest;
    const id = systemId(input.systemId);
    if (input.title !== undefined && typeof input.title !== "string") throw badRequest("title must be a string");
    return c.json(await rpc(systemStub(c.env, id).ontologyInitialize(id, input.title)), 201);
  })
  .get("/systems/:id/ontology-imports", requireAdmin, async c => {
    const { stub } = await destination(c);
    return c.json(await rpc(stub.ontologyImports()));
  })
  .post("/systems/:id/ontology-imports/preview", requireAdmin, async c => {
    const { id, stub } = await destination(c);
    const input = await boundedBody(c);
    if (!("package" in input)) throw badRequest("package is required");
    return c.json(await rpc(stub.ontologyImportPreview(id, input as unknown as OntologyImportPreviewRequest)), 201);
  })
  .get("/systems/:id/ontology-imports/:reviewId", requireAdmin, async c => {
    const { stub } = await destination(c);
    const r = await rpc(stub.ontologyImportGet(c.req.param("reviewId")));
    if (!r) throw notFound("import review not found"); return c.json(r);
  })
  .post("/systems/:id/ontology-imports/:reviewId/accept", requireAdmin, async c => {
    const { stub } = await destination(c);
    const input = await boundedBody(c);
    if (typeof input.hash !== "string" || !/^[a-f0-9]{64}$/.test(input.hash)) throw badRequest("reviewed hash is required");
    return c.json(await rpc(stub.ontologyImportAccept(c.req.param("reviewId"), input.hash)));
  });
