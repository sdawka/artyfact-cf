import { Hono } from "hono";
import { requireRealizationSecret } from "../auth";
import { commitEdit, listFiles, MAX_COMMIT_BYTES, parseScope, readFileAt } from "../editor";
import { badRequest, HttpError } from "../errors";
import { systemStub } from "../service";
import type { AppEnv, Ctx } from "./app";

const ref = (c: Ctx) => c.req.query("ref") || "head";

const tooLarge = () => new HttpError(413, "commit-too-large", `the request body is larger than ${MAX_COMMIT_BYTES} bytes`);

/**
 * The commit body as a JSON object, refusing more than MAX_COMMIT_BYTES: by `content-length` before reading, and while
 * streaming for a body sent without one.
 */
async function boundedBody(c: Ctx): Promise<Record<string, unknown>> {
  const declared = Number(c.req.header("content-length") ?? NaN);
  if (declared > MAX_COMMIT_BYTES) throw tooLarge();
  const chunks: Uint8Array[] = [];
  let n = 0;
  const reader = c.req.raw.body?.getReader();
  for (;;) {
    const r = reader ? await reader.read() : { done: true as const, value: undefined };
    if (r.done) break;
    n += r.value.length;
    if (n > MAX_COMMIT_BYTES) {
      await reader!.cancel();
      throw tooLarge();
    }
    chunks.push(r.value);
  }
  const text = new TextDecoder().decode(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw badRequest("body must be a JSON object");
  }
}

/** Editor routes: list and read files at a ref (app or Genome scope), and commit an edit to a realization's fork. */
export const editor = new Hono<AppEnv>()
  .get("/systems/:id/files", async (c) => c.json(await listFiles(c.env, c.req.param("id"), parseScope(c.req.query("scope")), ref(c))))
  .get("/systems/:id/file", async (c) =>
    c.json(await readFileAt(c.env, c.req.param("id"), parseScope(c.req.query("scope")), ref(c), c.req.query("path") ?? "")))
  // The realization's own secret (as for checkpoint/submit) or the admin bearer.
  .post("/systems/:id/realizations/:rid/commit", async (c) => {
    const systemId = c.req.param("id"), rid = c.req.param("rid");
    const who = await requireRealizationSecret(c.env, c.req.header("authorization"), async () =>
      [{ systemId, hash: await systemStub(c.env, systemId).realizationSecretHash(rid) }]);
    return c.json(await commitEdit(c.env, systemId, rid, await boundedBody(c), who.admin ? "admin" : "editor"), 201);
  });
