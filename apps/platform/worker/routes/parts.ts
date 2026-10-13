import { Hono } from "hono";
import { schema } from "@artyfact/model";
import type { PartResponse, PartsResponse, PublishPartRequest } from "../../shared/api";
import { requireAdmin, requireRealizationSecret } from "../auth";
import { HttpError, badRequest, notFound, unprocessable } from "../errors";
import { registryStub, systemStub } from "../service";
import { getPart, listParts, publishPart } from "../parts/service";
import { body, type AppEnv, type Ctx } from "./app";

const shared = { kind: "shared" } as const;
const system = (systemId: string) => ({ kind: "system", systemId }) as const;
const MAX_PART_REQUEST_BYTES = 256 * 1024;

async function boundedBody(c: Ctx): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header("content-length") ?? NaN);
  if (declared > MAX_PART_REQUEST_BYTES) throw new HttpError(413, "part-too-large", `the request body is larger than ${MAX_PART_REQUEST_BYTES} bytes`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = c.req.raw.body?.getReader();
  for (;;) {
    const result = reader ? await reader.read() : { done: true as const, value: undefined };
    if (result.done) break;
    size += result.value.length;
    if (size > MAX_PART_REQUEST_BYTES) {
      await reader!.cancel();
      throw new HttpError(413, "part-too-large", `the request body is larger than ${MAX_PART_REQUEST_BYTES} bytes`);
    }
    chunks.push(result.value);
  }
  const text = new TextDecoder().decode(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw badRequest("body must be a JSON object");
  }
}

function requestPackage(value: Record<string, unknown>) {
  const parsed = schema.PartPackage.safeParse((value as Partial<PublishPartRequest>).package);
  if (!parsed.success) throw unprocessable("invalid-part-package", "package does not match the PartPackage schema", parsed.error.flatten());
  return parsed.data;
}

async function authorizeSystemRead(c: Ctx): Promise<void> {
  const systemId = c.req.param("id")!;
  await requireRealizationSecret(c.env, c.req.header("authorization"), async () =>
    Promise.all((await systemStub(c.env, systemId).realizations()).map(async (r) => ({
      systemId,
      hash: await systemStub(c.env, systemId).realizationSecretHash(r.id),
    }))),
  );
}

async function requireKnownSystem(c: Ctx): Promise<void> {
  const systemId = c.req.param("id")!;
  if (!(await registryStub(c.env).hasSystem(systemId))) throw notFound(`system ${systemId} is not imported`);
}

async function detail(c: Ctx, scope: typeof shared | ReturnType<typeof system>) {
  const part = await getPart(c.env, scope, c.req.param("partId")!, c.req.param("version")!);
  if (!part) throw notFound(`part ${c.req.param("partId")}@${c.req.param("version")} is not available in this scope`);
  return c.json<PartResponse>({ part });
}

export const parts = new Hono<AppEnv>()
  .get("/parts", async (c) => c.json<PartsResponse>({ parts: await listParts(c.env, shared) }))
  .get("/parts/:partId/:version", (c) => detail(c, shared))
  .post("/parts", requireAdmin, async (c) => c.json<PartResponse>({ part: await publishPart(c.env, shared, requestPackage(await boundedBody(c))) }, 201))
  .get("/systems/:id/parts", async (c) => {
    await authorizeSystemRead(c);
    return c.json<PartsResponse>({ parts: await listParts(c.env, system(c.req.param("id")!)) });
  })
  .get("/systems/:id/parts/:partId/:version", async (c) => {
    await authorizeSystemRead(c);
    return detail(c, system(c.req.param("id")!));
  })
  .post("/systems/:id/parts", requireAdmin, async (c) => {
    await requireKnownSystem(c);
    return c.json<PartResponse>({ part: await publishPart(c.env, system(c.req.param("id")!), requestPackage(await boundedBody(c))) }, 201);
  });
