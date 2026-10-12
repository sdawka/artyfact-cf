import { Hono } from "hono";
import type { ChangelogEntry, ChangelogResponse, FileCompare, GenomeCompare, RevisionsResponse, SystemCompare } from "../../shared/api";
import { changelog as changelogRows, changelogEntry } from "../changelog";
import { compareFile, compareGenome, compareSystemRefs, revisions } from "../compare";
import type { AppEnv, Ctx } from "./app";

/** An omitted or empty `from` means "the parent of `to`"; an omitted `to` is the head. */
const refs = (c: Ctx) => ({ from: c.req.query("from") || undefined, to: c.req.query("to") || "head" });

// `/api/systems/:id/history` (routes/history.ts) stays as an alias of the commit list for one release.
export const changelog = new Hono<AppEnv>()
  .get("/systems/:id/revisions", async (c) => c.json<RevisionsResponse>(await revisions(c.env, c.req.param("id"))))
  .get("/systems/:id/changelog", async (c) =>
    c.json<ChangelogResponse>(await changelogRows(c.env, c.req.param("id"), { limit: c.req.query("limit"), before: c.req.query("before") || undefined })))
  .get("/systems/:id/changelog/:commitId", async (c) => c.json<ChangelogEntry>(await changelogEntry(c.env, c.req.param("id"), c.req.param("commitId"))))
  .get("/systems/:id/compare/system", async (c) => {
    const { from, to } = refs(c);
    return c.json<SystemCompare>(await compareSystemRefs(c.env, c.req.param("id"), from, to));
  })
  .get("/systems/:id/compare/genome", async (c) => {
    const { from, to } = refs(c);
    return c.json<GenomeCompare>(await compareGenome(c.env, c.req.param("id"), from, to));
  })
  .get("/systems/:id/compare/file", async (c) => {
    const { from, to } = refs(c);
    return c.json<FileCompare>(await compareFile(c.env, c.req.param("id"), c.req.query("scope"), from, to, c.req.query("path")));
  });
