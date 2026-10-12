import { Hono } from "hono";
import type {
  ChangelogEntry, ChangelogResponse, FileCompare, FileSide, GenomeCompare, ResolvedRef, RevisionsResponse, SystemCommit, SystemCompare,
} from "../../shared/api";
import type { AppEnv } from "./app";

// Stub (B0): typed empty shapes until the changelog/compare slice (B2) implements these routes.

const ref = (r: string | undefined): ResolvedRef => ({ ref: r ?? "head", repo: "", commit: "" });
const side = (r: string | undefined): FileSide => ({ ...ref(r), hash: null, text: null, size: 0 });
const commit = (id: string): SystemCommit => ({
  id, parent: null, genomeCommit: "", manifest: [], evolutions: [], candidates: [], rejected: [], evidence: [],
  decision: { by: "", policy: "", rationale: "", at: "" },
});
const compare = (to: string): SystemCompare => ({
  from: null, to: commit(to), genome: { from: null, to: "", delta: null }, app: null,
  manifest: { templateVersions: [], hookVersions: [], platformChanged: false }, identical: true,
});

export const changelog = new Hono<AppEnv>()
  .get("/systems/:id/revisions", (c) => c.json<RevisionsResponse>({ revisions: [] }))
  .get("/systems/:id/changelog", (c) => c.json<ChangelogResponse>({ rows: [] }))
  .get("/systems/:id/changelog/:commitId", (c) => {
    const id = c.req.param("commitId");
    const cmp = compare(id);
    return c.json<ChangelogEntry>({
      ...cmp,
      row: {
        id, parent: null, at: "", by: "", policy: "", rationale: "", kind: "promotion", evolutions: [], candidates: [], genomeCommit: "",
        summary: { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, filesChanged: 0, criteriaAffected: 0 },
        manifestHash: null, platform: null, builds: [], deployment: null,
      },
      decision: cmp.to.decision, criteria: [], codeLinks: [],
    });
  })
  .get("/systems/:id/compare/system", (c) => c.json<SystemCompare>(compare(c.req.query("to") ?? "head")))
  .get("/systems/:id/compare/genome", (c) =>
    c.json<GenomeCompare>({ from: null, to: ref(c.req.query("to")), delta: null, files: { added: [], modified: [], removed: [] } }))
  .get("/systems/:id/compare/file", (c) =>
    c.json<FileCompare>({ path: c.req.query("path") ?? "", from: side(c.req.query("from")), to: side(c.req.query("to")), truncated: false, binary: false }));
