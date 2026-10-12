import { Hono } from "hono";
import type { FileResponse, FilesResponse, ResolvedRef } from "../../shared/api";
import type { AppEnv, Ctx } from "./app";

// Stub (B0): typed empty shapes until the editor slice (B1) implements these routes.

const ref = (c: Ctx): ResolvedRef => ({ ref: c.req.query("ref") ?? "head", repo: "", commit: "" });

export const editor = new Hono<AppEnv>()
  .get("/systems/:id/files", (c) => c.json<FilesResponse>({ ref: ref(c), files: [] }))
  .get("/systems/:id/file", (c) =>
    c.json<FileResponse>({ ref: ref(c), path: c.req.query("path") ?? "", hash: "", text: null, size: 0, truncated: false, binary: false }))
  .post("/systems/:id/realizations/:rid/commit", (c) => c.json({ error: "not-implemented" }, 501));
