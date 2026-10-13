import type { ChangelogEntry, ChangelogRow, SystemCommit } from "../../../shared/api";

export const SYSTEM = "system.peopling";
export const APP = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

export const row = (o: Partial<ChangelogRow> = {}): ChangelogRow => ({
  id: "sc-1",
  parent: null,
  at: "2026-01-01T00:00:00.000Z",
  by: "admin",
  policy: "admin-approval",
  rationale: "Initial import",
  kind: "import",
  evolutions: [],
  candidates: [],
  genomeCommit: "9e8d7c6b5a4938271605f4e3d2c1b0a998877665",
  summary: { nodesAdded: 0, nodesChanged: 0, nodesRemoved: 0, filesChanged: 0, criteriaAffected: 0 },
  manifestHash: null,
  platform: null,
  builds: [],
  deployment: null,
  ...o,
});

export const older = row();
export const newer = row({
  id: "sc-2",
  parent: "sc-1",
  at: "2026-01-03T00:00:00.000Z",
  rationale: "Add the People screen",
  kind: "promotion",
  evolutions: [{ id: "evolution.2", title: "People screen" }],
  candidates: [{ id: "cand.1", realization: "realization.1", commit: APP, repo: "peopling-app", agent: "agent-alpha" }],
  summary: { nodesAdded: 2, nodesChanged: 1, nodesRemoved: 0, filesChanged: 4, criteriaAffected: 3 },
  manifestHash: "f".repeat(64),
  platform: { repo: "platform", commit: "1234567890abcdef1234567890abcdef12345678" },
  builds: [{ id: "build.2", status: "passed", kind: "production", commit: APP, finishedAt: "2026-01-03T00:05:00.000Z" }],
  deployment: {
    id: "deploy.2", kind: "production", status: "live", repo: "peopling-app", commit: APP, systemCommit: "sc-2", by: "admin",
    createdAt: "2026-01-03T00:06:00.000Z", updatedAt: "2026-01-03T00:06:00.000Z",
  },
});

const sc = (id: string, parent: string | null): SystemCommit => ({
  id, parent, genomeCommit: older.genomeCommit, manifest: [], evolutions: [], candidates: [], rejected: [], evidence: [],
  decision: { by: "admin", policy: "admin-approval", rationale: id === "sc-2" ? newer.rationale : older.rationale, at: older.at },
});

export const entry: ChangelogEntry = {
  from: sc("sc-1", null),
  to: sc("sc-2", "sc-1"),
  genome: {
    from: older.genomeCommit,
    to: "1111111111111111111111111111111111111111",
    delta: { added: ["screen.reminders"], removed: [], changed: [{ id: "screen.people", fields: ["name"] }], affectedCriteria: [], affectedJourneys: [] },
    files: { added: [], modified: ["thing.webapp/section.ui/screen.people/node.yaml"], removed: [] },
    pathNodes: { "thing.webapp/section.ui/screen.people/node.yaml": ["screen.people", "screen.reminders"] },
  },
  app: {
    from: { ref: "sc-1", repo: "peopling-app", commit: "0".repeat(40) },
    to: { ref: "sc-2", repo: "peopling-app", commit: APP },
    files: { added: ["src/screens/People.tsx"], modified: [], removed: ["src/old.ts"] },
    pathNodes: { "src/screens/People.tsx": ["screen.people"] },
  },
  manifest: { templateVersions: [], hookVersions: [], platformChanged: false },
  identical: false,
  row: newer,
  decision: sc("sc-2", "sc-1").decision,
  criteria: [{ id: "C.webapp.screen.people", before: "not-run", after: "pass", evaluation: "eval.7" }],
  codeLinks: [
    { scope: "app", path: "src/old.ts", repo: "peopling-app", commit: "0".repeat(40), nodes: [], status: "removed" },
    { scope: "app", path: "src/screens/People.tsx", repo: "peopling-app", commit: APP, nodes: ["screen.people"], status: "added" },
    { scope: "genome", path: "thing.webapp/section.ui/screen.people/node.yaml", repo: "peopling-genome", commit: "1".repeat(40), nodes: ["screen.people", "screen.reminders"], status: "modified" },
  ],
};
