import { Hono } from "hono";
import { requireRealizationSecret } from "../auth";
import { commitEdit, listFiles, parseScope, readFileAt } from "../editor";
import { systemStub } from "../service";
import { body, type AppEnv, type Ctx } from "./app";

const ref = (c: Ctx) => c.req.query("ref") || "head";

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
    return c.json(await commitEdit(c.env, systemId, rid, await body(c), who.admin ? "admin" : "editor"), 201);
  });
