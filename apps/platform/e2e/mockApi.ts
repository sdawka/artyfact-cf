import { readFileSync } from "node:fs";
import type { Page, Route } from "@playwright/test";
import type {
  Build, ChangelogEntry, ChangelogRow, Deployment, DeploymentsResponse, FileCompare, FileResponse, FilesResponse, GenomeCompare, ModelBundle,
  PartRecord, PartSummary, PhenomeEventsResponse, RealizedArtifact, RevisionOption, SystemCommit, SystemCompare, SystemSummary,
} from "../shared/api";

/**
 * Route mock for populated visuals in fixture mode: `await mockApi(page)` before `page.goto` makes `/api/**` answer
 * from {@link MockData} (override any part with `mockApi(page, { builds: [...] })`), so the SPA runs in API mode with
 * realistic data and no backend. Unlisted API routes answer 404 `not-found`; the SSE stream answers 204 (the client
 * then polls). Every list is newest first, like the server. Non-GET requests answer 405 `method-not-allowed` unless
 * `writes` handles them (return true once the route is fulfilled), so a write flow never reads a GET body by mistake.
 */
export interface MockData {
  systems: SystemSummary[];
  /** Model bundle per System id; defaults to the Keep in Touch fixture for `system.keep-in-touch`. */
  bundles: Record<string, ModelBundle>;
  revisions: RevisionOption[];
  commits: SystemCommit[];
  changelog: ChangelogRow[];
  /** Changelog entry per commit id. */
  entries: Record<string, ChangelogEntry>;
  compareSystem: SystemCompare | null;
  compareGenome: GenomeCompare | null;
  /** Files per scope (`app` | `genome`), path → text. */
  files: { app: Record<string, string>; genome: Record<string, string> };
  builds: Build[];
  deployments: DeploymentsResponse;
  phenome: PhenomeEventsResponse;
  /** Public shared catalog only; System-private Parts are deliberately unavailable to Home. */
  parts: PartSummary[];
  partRecords: Record<string, PartRecord>;
  artifacts: RealizedArtifact[];
  /** Handler for POST/PUT/PATCH/DELETE; return true when it fulfilled the route. */
  writes?: (route: Route, url: URL) => Promise<boolean> | boolean;
}

export const SID = "system.keep-in-touch";
const HEAD_APP = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const OLD_APP = "0f9e8d7c6b5a49382716051f2e3d4c5b6a798011";
const GENOME = "9e8d7c6b5a4938271605f4e3d2c1b0a998877665";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../src/fixtures/${name}`, import.meta.url), "utf8")) as unknown;

export const mockBuild = (o: Partial<Build> = {}): Build => ({
  id: "build.2", status: "passed", kind: "production", commit: HEAD_APP, url: "https://keep-in-touch.example.workers.dev",
  buildId: HEAD_APP, realization: null, candidate: null, reporter: "ci", steps: [
    { name: "install", status: "passed", durationMs: 8_200 }, { name: "test", status: "passed", durationMs: 14_900 },
    { name: "build", status: "passed", durationMs: 6_100 }, { name: "deploy", status: "passed", durationMs: 4_300 },
  ], startedAt: minutesAgo(42), finishedAt: minutesAgo(40), createdAt: minutesAgo(42), updatedAt: minutesAgo(40), ...o,
});

export const mockDeployment = (o: Partial<Deployment> = {}): Deployment => ({
  id: "deploy.2", kind: "production", status: "live", repo: "keep-in-touch-app", commit: HEAD_APP, systemCommit: "sc-2",
  build: "build.2", url: "https://keep-in-touch.example.workers.dev", buildId: HEAD_APP, by: "admin",
  createdAt: minutesAgo(40), updatedAt: minutesAgo(40), ...o,
});

const commit = (id: string, parent: string | null, rationale: string, at: string, o: Partial<SystemCommit> = {}): SystemCommit => ({
  id, parent, genomeCommit: GENOME, manifest: [], evolutions: [], candidates: [], rejected: [], evidence: [],
  decision: { by: "admin", policy: "admin-approval", rationale, at }, ...o,
});

const row = (c: SystemCommit, o: Partial<ChangelogRow> = {}): ChangelogRow => ({
  id: c.id, parent: c.parent, at: c.decision.at, by: c.decision.by, policy: c.decision.policy, rationale: c.decision.rationale,
  kind: "promotion", evolutions: [], candidates: [], genomeCommit: c.genomeCommit,
  summary: { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, filesChanged: 0, criteriaAffected: 0 },
  manifestHash: null, platform: null, builds: [], deployment: null, ...o,
});

/** Two Systems with different states, a two-commit changelog, a passed production build, a live deployment and events. */
export function defaultMockData(): MockData {
  const bundle = fixture("keep-in-touch.model.json") as ModelBundle;
  const genomeFiles = (fixture("keep-in-touch.files.json") as { files: Record<string, string> }).files;
  const sc1 = commit("sc-1", null, "Initial import", minutesAgo(60 * 26), { manifest: [] });
  const sc2 = commit("sc-2", "sc-1", "Add the People screen", minutesAgo(45), {
    evolutions: ["evolution.1"], candidates: ["cand.1"],
  });
  const output: RealizedArtifact = { id: "output.build.2", thingId: "thing.webapp", artifactId: "artifact.webapp", source: { repo: "keep-in-touch-app", commit: HEAD_APP }, genomeCommit: GENOME, build: "build.2", locator: "workers-version:mock-v2", digest: "sha256:mock-output", createdAt: minutesAgo(40) };
  const build = mockBuild({ source: output.source, genomeCommit: GENOME, thingId: output.thingId, artifactId: output.artifactId, output });
  const deployment = mockDeployment({ output: output.id });
  const changelog = [
    row(sc2, {
      evolutions: [{ id: "evolution.1", title: "People screen" }],
      candidates: [{ id: "cand.1", realization: "realization.1", commit: HEAD_APP, repo: "keep-in-touch-app", agent: "agent-alpha" }],
      summary: { nodesAdded: 2, nodesChanged: 1, nodesRemoved: 0, filesChanged: 4, criteriaAffected: 3 },
      builds: [{ id: build.id, status: build.status, kind: build.kind, commit: build.commit, url: build.url, buildId: build.buildId, finishedAt: build.finishedAt }],
      deployment,
    }),
    row(sc1, { kind: "import", summary: { nodesAdded: 120, nodesChanged: 0, nodesRemoved: 0, filesChanged: 0, criteriaAffected: 22 } }),
  ];
  const appFiles = {
    "src/index.ts": 'import { app } from "./app";\nexport default app;\n',
    "src/screens/People.tsx": "export function People() {\n  return <h1>People</h1>;\n}\n",
  };
  const compareSystem: SystemCompare = {
    from: sc1, to: sc2,
    genome: { from: GENOME, to: GENOME, delta: null, files: { added: [], modified: [], removed: [] }, pathNodes: {} },
    app: {
      from: { ref: "sc-1", repo: "keep-in-touch-app", commit: OLD_APP, systemCommit: "sc-1" },
      to: { ref: "sc-2", repo: "keep-in-touch-app", commit: HEAD_APP, systemCommit: "sc-2" },
      files: { added: ["src/screens/People.tsx"], modified: ["src/index.ts"], removed: [] },
      pathNodes: { "src/screens/People.tsx": ["screen.people"] },
    },
    manifest: { templateVersions: [], hookVersions: [], platformChanged: false },
    identical: false,
  };
  return {
    systems: [
      {
        systemId: SID, title: "Keep in Touch", head: "sc-2", genomeRepo: "keep-in-touch-genome", appRepo: "keep-in-touch-app",
        genomeCommit: GENOME, phase: "realizing", evolutionCounts: { realizing: 1, promoted: 1 }, updatedAt: minutesAgo(12),
        appCommit: HEAD_APP, built: true, realizationCounts: { evolving: 1, pending: 0, awaitingAdmin: 0, awaitingReview: 0 }, openCandidates: 1,
        latestBuild: changelog[0]!.builds[0]!, deployment: { production: deployment, previews: 1 }, deployState: "live",
        phenome: { events: 37, lastEmittedAt: minutesAgo(3) }, readiness: { errors: 0, missing: 0 },
        signifiers: ["evolving", "built", "deployed", "observed"],
      },
      {
        systemId: "system.field-notes", title: "Field Notes", head: null, genomeRepo: "field-notes-genome", appRepo: "field-notes-app",
        genomeCommit: GENOME, phase: "unrealized", evolutionCounts: { proposed: 1 }, updatedAt: minutesAgo(60 * 5),
        built: false, realizationCounts: { evolving: 0, pending: 0, awaitingAdmin: 1, awaitingReview: 1 }, openCandidates: 0, latestBuild: null,
        deployment: { production: null, previews: 0 }, deployState: "none", phenome: { events: 0 }, readiness: { errors: 2, missing: 3 },
        // A Genome candidate awaits accept, so candidates exist: `unrealized` (no candidates ever) does not apply.
        signifiers: ["pending-realization", "awaiting-admin", "not-fully-built"],
      },
    ],
    bundles: { [SID]: { ...bundle, revision: "head" } },
    revisions: [
      { id: "head", kind: "head", label: "head" },
      { id: "sc-2", kind: "commit", label: "sc-2 · Add the People screen", at: sc2.decision.at },
      { id: "sc-1", kind: "commit", label: "sc-1 · Initial import", at: sc1.decision.at },
      { id: "cand.2", kind: "candidate", label: "cand.2 · agent-beta", evolution: "evolution.2", state: "evaluated" },
    ],
    commits: [sc2, sc1],
    changelog,
    entries: {
      "sc-2": {
        ...compareSystem, row: changelog[0]!, decision: sc2.decision,
        criteria: [{ id: "C.webapp.screen.people", before: "not-run", after: "pass", evaluation: "eval.1" }],
        codeLinks: [
          { scope: "app", path: "src/screens/People.tsx", repo: "keep-in-touch-app", commit: HEAD_APP, nodes: ["screen.people"], status: "added" },
          { scope: "app", path: "src/index.ts", repo: "keep-in-touch-app", commit: HEAD_APP, nodes: [], status: "modified" },
        ],
      },
    },
    compareSystem,
    compareGenome: {
      from: { ref: "sc-1", repo: "keep-in-touch-genome", commit: GENOME }, to: { ref: "sc-2", repo: "keep-in-touch-genome", commit: GENOME },
      delta: null, files: { added: [], modified: [], removed: [] },
    },
    files: { app: appFiles, genome: genomeFiles },
    builds: [build, mockBuild({ id: "build.1", status: "failed", commit: OLD_APP, buildId: OLD_APP, kind: "preview", candidate: "cand.0",
      error: "test failed: People screen renders", startedAt: minutesAgo(70), finishedAt: minutesAgo(68), createdAt: minutesAgo(70), updatedAt: minutesAgo(68) })],
    deployments: { production: deployment, history: [deployment, mockDeployment({ id: "deploy.1", status: "superseded", commit: OLD_APP, systemCommit: "sc-1", createdAt: minutesAgo(60 * 25) })] },
    phenome: {
      events: Array.from({ length: 5 }, (_, i) => ({
        seq: 37 - i, id: `ev-${37 - i}`, systemId: SID, thingId: "thing.webapp", artifactId: "artifact.webapp", buildId: HEAD_APP,
        commit: HEAD_APP, systemCommit: "sc-2", deploymentId: "deploy.2", emittedAt: minutesAgo(3 + i * 7), receivedAt: minutesAgo(3 + i * 7),
        kind: i % 2 ? "screen.viewed" : "contact.logged", subject: i % 2 ? "screen.people" : "operation.logContact", payload: {},
      })),
      versions: [{ output: null, genomeCommit: null, key: HEAD_APP, buildId: HEAD_APP, commit: HEAD_APP, deployment: "deploy.2", systemCommit: "sc-2", count: 37 }],
    },
    parts: [{ partId: "part.ui.buttons", version: "2.1.0", name: "Button system", description: "Shared button primitives", scope: { kind: "shared" }, digest: "sha256:part-buttons", publishedAt: minutesAgo(90), dependencies: [] }],
    partRecords: {
      "part.ui.buttons@2.1.0": {
        package: { id: "part.ui.buttons", version: "2.1.0", name: "Button system", description: "Shared button primitives", visibility: "shared", published: true, payload: { model: {}, files: {} }, inputs: [], commands: [], digest: `sha256:${"a".repeat(64)}` },
        scope: { kind: "shared" }, digest: "sha256:part-buttons", publishedAt: minutesAgo(90),
      },
    },
    artifacts: [output],
  };
}

const fileList = (files: Record<string, string>, ref: string, scope: string): FilesResponse => ({
  ref: { ref, repo: `mock/${scope}`, commit: HEAD_APP },
  files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => ({ path, hash: `h-${path}`, size: text.length })),
});

/** Installs the `/api/**` route mock. Returns the data so tests can assert against it. */
export async function mockApi(page: Page, overrides: Partial<MockData> = {}): Promise<MockData> {
  const data: MockData = { ...defaultMockData(), ...overrides };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const notFound = (route: Route, what: string) => json(route, { error: { code: "not-found", message: `${what} not found` } }, 404);

  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      if (data.writes && (await data.writes(route, url))) return;
      return json(route, { error: { code: "method-not-allowed", message: `${route.request().method()} ${url.pathname} is not mocked` } }, 405);
    }
    const q = url.searchParams;
    const parts = url.pathname.split("/").slice(2).map(decodeURIComponent); // ["systems", id, ...rest]
    if (parts[0] === "health") return json(route, { status: "ok", service: "artyfact-platform", time: new Date().toISOString() });
    if (parts[0] === "parts") {
      if (parts.length === 1) return json(route, { parts: data.parts });
      const record = data.partRecords[`${parts[1]}@${parts[2]}`];
      return record ? json(route, { part: record }) : notFound(route, "part");
    }
    if (parts[0] !== "systems") return notFound(route, url.pathname);
    if (parts.length === 1) return json(route, { systems: data.systems });
    const [, sid, section, ...rest] = parts;
    const scope = (q.get("scope") ?? "app") as "app" | "genome";
    switch (section) {
      case "model": {
        const b = data.bundles[sid!];
        return b ? json(route, { ...b, revision: q.get("rev") ?? "head" }) : notFound(route, `model of ${sid}`);
      }
      case "readiness": {
        const b = data.bundles[sid!];
        return b ? json(route, b.readiness) : notFound(route, `readiness of ${sid}`);
      }
      case "work":
      case "evolutions":
        return json(route, { evolutions: [], realizations: [] });
      case "evaluations":
        return json(route, { evaluations: [] });
      case "conflicts":
        return json(route, { conflicts: [] });
      case "history":
        return json(route, { commits: data.commits });
      case "revisions":
        return json(route, { revisions: data.revisions });
      case "changelog":
        if (rest[0]) return data.entries[rest[0]] ? json(route, data.entries[rest[0]]) : notFound(route, `changelog entry ${rest[0]}`);
        return json(route, { rows: data.changelog });
      case "compare":
        if (rest[0] === "system") return data.compareSystem ? json(route, data.compareSystem) : notFound(route, "compare");
        if (rest[0] === "genome") return data.compareGenome ? json(route, data.compareGenome) : notFound(route, "compare");
        if (rest[0] === "file") {
          const path = q.get("path") ?? "";
          const text = data.files[scope][path] ?? null;
          const side = (ref: string) => ({ ref, repo: `mock/${scope}`, commit: HEAD_APP, hash: text === null ? null : `h-${path}`, text, size: text?.length ?? 0 });
          const body: FileCompare = {
            path, from: { ...side(q.get("from") ?? "parent"), text: null, hash: null, size: 0 }, to: side(q.get("to") ?? "head"), truncated: false, binary: false,
          };
          return json(route, body);
        }
        return notFound(route, url.pathname);
      case "files":
        return json(route, fileList(data.files[scope], q.get("ref") ?? "head", scope));
      case "file": {
        const path = q.get("path") ?? "";
        const text = data.files[scope][path];
        if (text === undefined) return notFound(route, path);
        const body: FileResponse = {
          ref: { ref: q.get("ref") ?? "head", repo: `mock/${scope}`, commit: HEAD_APP }, path, hash: `h-${path}`, text, size: text.length,
          truncated: false, binary: false, nodes: data.compareSystem?.app?.pathNodes[path] ?? [],
        };
        return json(route, body);
      }
      case "builds":
        return json(route, { builds: data.builds.filter((b) => (!q.get("commit") || b.commit === q.get("commit")) && (!q.get("kind") || b.kind === q.get("kind"))) });
      case "realizations":
        if (rest[1] === "builds") return json(route, { builds: data.builds.filter((b) => b.realization === rest[0]) });
        return notFound(route, url.pathname);
      case "deployments":
        return json(route, data.deployments);
      case "phenome":
        return json(route, data.phenome);
      case "artifacts":
        return json(route, { artifacts: data.artifacts });
      case "events":
        return route.fulfill({ status: 204, body: "" });
      default:
        return notFound(route, url.pathname);
    }
  });
  return data;
}
