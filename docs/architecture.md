# Architecture

artyfact is one Cloudflare Worker with Static Assets, one Durable Object class, a Queue consumer and a binding to Artifacts. This page follows one change from start to promotion. Wire-level detail is in [design/backend.md](design/backend.md).

```mermaid
sequenceDiagram
  autonumber
  participant P as Person (UI)
  participant W as Worker (Hono)
  participant D as SystemAuthority (DO)
  participant A as Artifacts
  participant G as Agent + CLI
  participant Q as Queue
  P->>W: Start work on evolution.1
  W->>D: create realization
  W->>A: fork app repo, wait ready, issue write token
  W-->>P: task packet, CLI line, token (once)
  G->>A: clone fork, work, git push
  G->>W: submit (CLI, primary path)
  A-->>Q: cf.artifacts.repo.pushed (optional)
  Q->>W: queue handler
  W->>A: read commit and trees, diff against base
  W->>D: record candidate, run hooks, store evaluations
  P->>W: Promote candidate, expectedHead
  W->>D: promote (one transaction)
  D-->>W: new System commit, or 409 stale-base
```

## Pieces

**Static Assets and the Worker.** `run_worker_first` is set for `/api/*` only. Every other path serves the single-page app. The SPA polls the API and also listens to `/api/systems/:id/events` over server-sent events. Events are not replayed, so the SPA refetches on every connect.

**Artifacts.** One namespace per deployment holds, for each System, a Genome repository and an app repository, plus one shared `platform` repository. Names come from the System id through `packages/cli/src/naming.ts`, a dependency-free module the CLI and the Worker both import: `system.keep-in-touch` gives `keep-in-touch.genome` and `keep-in-touch.app`, and forks are `<repo>--r<N>`. A realization forks one of them. Reads go through the binding: read a commit, read its tree, read files, and compare tree entry hashes to find changed paths. A `source-map.yaml` in the app maps paths to Genome nodes. A path with no mapping becomes `unmapped:<path>` and its verdict is `unknown`, never a guess.

**Import and platform provenance.** `POST /api/systems/import` takes `{systemId, genomeRepo?, appRepo?, scaffoldFrom?, force?}`. Omitted repositories are derived from the slug. An id that is not a lower-case name is refused with 400 `invalid-system-id`, so no two ids share repositories. The Worker reads the head of `platform`, checks that every pinned Rule Pack and template is there, and records `platform: {repo, commit}` on the head and in the manifest of every System commit. A re-import whose only change is a new `platform` commit updates that record in place and writes no System commit, so open work does not go stale. A namespace without `platform` records `null` and shows the readiness warning `platform.unsynced`. A `platform` that cannot be read keeps the recorded value and adds `platform.unreadable`. Neither warning blocks anything. Evaluation still uses the templates and Rule Packs bundled into the Worker, so `platform` is provenance only.

**Submission paths.** `artyfact submit` pushes the commit to the fork and calls the API. A Queue consumer for `cf.artifacts.repo.pushed` does the same from the event. Artifacts only emits push events for a repository-level subscription, which is not created automatically per fork, so the CLI path is the primary one. Both converge on one candidate per realization and commit.

**Hooks.** Each Criterion lists hooks, and each hook names an engine: manifest, diff, model-rules, system-one or http. A submission runs the hooks of the Evolution's acceptance criteria, of criteria whose subject is a changed node, and of System criteria gated on submission. A hook the platform cannot run comes back `not-run` with verdict `unknown`. The http health hook only fetches preview hosts on the allowlist, does not follow redirects and does not echo response bodies.

**Overlap.** After each submission the platform compares the candidate with the others in flight. It reports three kinds of conflict: file, soft-semantic and hard-semantic. Soft-semantic means the candidates touch nodes that share a journey, policy or outcome hypothesis even though no file is shared. The Promotion panel treats file and hard-semantic conflicts among selected candidates as blocking and soft-semantic conflicts as advisories that need a rationale. The server enforces the same rule through the overlap hook's verdict on the gate: hard-semantic gives `fail`, file or soft gives `unknown`, none gives `pass`. That verdict blocks only if its criterion is in the blocking set.

**Promotion gate.** The blocking set is the Evolution's acceptance criteria plus criteria gated on promotion, limited to hard criteria with at least one bound hook. Each blocking criterion needs a completed `pass` for this exact candidate. If the gate cannot be computed it fails closed with 409 `gate-unavailable`. Hooks run again with fresh facts just before the swap: the base is still current, the manifest binds exactly the promoted commits, and the evidence is fresh.

**Compare-and-swap.** `SystemAuthority.promote` runs inside one synchronous transaction. It reads the head and compares it with `expectedHead`. A mismatch throws and the API returns 409 `stale-base` with the current head. On success it writes a System commit whose manifest is hashed canonical JSON, moves the head, marks sibling candidates rejected and marks the Evolution promoted.

**Genome amendments.** An agent can target the Genome repository instead of the app. The platform loads the amended Genome, runs the Rule Packs, diffs the Readiness findings, and asks System One to review each changed node. The admin accepts or rejects. Accepting records the fork commit as the new Genome commit and the review panel requires an interpretation, which is stored with the decision.

**Secrets and auth.** `ADMIN_TOKEN` guards import, start work, accept, reject and promote. Checkpoint, submit, sync, status and packet take the per-realization secret or the admin token. Read routes are unauthenticated. Fork tokens are scoped to one fork and returned only when work starts. The CLI reads the token from an environment variable and never writes it to disk.

## Data

| Store | Holds | Loss means |
|---|---|---|
| Artifacts | Genome and app source, forks | The System is gone |
| Durable Object SQLite | Head, System commits, candidates, evaluations and observations | Review history is gone |
