# Intent authoring and ontology integrity

Status: proposed design for user review, 2026-10-14. Scope is approved; this design and its implementation plan have not yet been reviewed. Extends [ontology](ontology.md), [lifecycle](lifecycle.md) and [UI](ui.md).

## Outcome and boundaries

A person can describe a new System to a local agent, clarify its meaning, inspect the resulting ontology, run meaningful integrity checks, repair findings and agree the exact Genome. The same loop works for changes to an existing System. Artyfact's own Genome is the first real example, visible in the production app's System map.

Local agent authoring is sufficient. Reuse native packages, Genome trees, import review, Evolution proposals and existing model providers. No hosted agent runner, automatic implementation, mandatory source repository, mandatory Part, or automatic semantic approval is introduced. Existing implementation and runtime evidence remain separate.

## Authoring from intent

Extend the shipped Genome skill and generated AGENTS.md with distinct paths for new intent and existing code. A new-intent brief records the user's statements, cited canonical sources, purposes, actors, boundaries, concepts, relationships, constraints, observable acceptance criteria, explicit exclusions and unresolved questions. The agent asks only consequential clarification questions, marks assumptions and preserves disagreements. It does not invent user agreement, implemented behavior or executable evidence.

The brief is an ordinary versioned Markdown source artifact beside the Genome. Generated nodes carry links through a versioned authoring manifest containing stable node IDs, brief sections and repo-relative document references; references include content hashes so drift is visible. This manifest is metadata, never an executable instruction source. No secrets, local absolute paths or agent credentials are included. Canonical sidecars are `intent/brief.md` (UTF-8, at most 64 KiB) and `intent/manifest.json` (strict versioned JSON, at most 128 KiB), relative to the Genome root. A separate allowlisted sidecar reader/exporter preserves them; the node-tree codec remains unchanged. Hash the brief bytes exactly and the validated manifest as canonical JSON with sorted object keys; array order remains meaningful. Reject duplicate keys and malformed source paths. Both sidecar hashes participate in preview, remote snapshot, report and staleness identity. Export/import must round-trip the original brief bytes and manifest meaning; missing sidecars mean intent fidelity was not checked.

The agent produces native node.yaml files and, only when the vocabulary needs extension, a native ontology package. Existing package inspection and accepted-template resolution apply. Proposed behavior and currently implemented behavior remain explicit in the brief and node content. A System/Thing can stop at Genome-only without fake source bindings. Existing-code authoring still derives factual claims from source and tests.

Start provides a copyable local-agent handoff for this path before a package already exists, then accepts the resulting files for preview. Browser forms collect intent and render results; they do not need an embedded model that creates the initial ontology. Existing-System amendments use the same brief and integrity contract while preserving proposal pinning and Genome-only approval.

## One integrity report

Introduce a shared report used by CLI, import preview, proposal review and the app. Its identity includes System, exact Genome/content hash, resolved package/template closure digest, brief/manifest hash and policy version. Semantic provenance includes provider/model, questions, thresholds, budget and truncation. The template closure is the sorted selected package pins and their transitive dependencies plus exact bundled-template version/content hashes, not the whole accepted-package catalog. An unrelated catalog addition cannot stale a report. Missing closure members in this System scope block execution. Findings identify subjects, source statements when available, severity, evidence and a suggested clarification or repair. Suggestions never edit accepted state automatically.

The report has independent structural and semantic sections and an overall status:

| Status | Meaning |
| --- | --- |
| blocked | Parsing/reference/declared-constraint errors, missing required content, or an incomplete deterministic evaluation prevent acceptance. |
| needs-review | Structural checks completed, but semantic findings, unresolved intent, missing/stale source evidence, provider failure/off, budget limits or uncertainty require a person. |
| passed | Required checks completed for this exact snapshot without blockers or unresolved review findings. This is an automated result, not proof of user agreement or implementation. |

Warnings follow an explicit versioned policy; unresolved semantic warnings cannot silently produce passed. Structural-only validation reports semantics as not run. Keep legacy CLI JSON fields compatible, but replace unqualified 'ready' copy with what was actually checked and expose the new report/status. Full-check CLI exit codes distinguish passed (0), blocked (1) and needs-review (2); command/transport failures remain explicit errors. Existing lightweight validation keeps its legacy exit contract while clearly labeling its limited scope.

Structural evaluation covers loadability, template form, identifiers, containment, references, endpoint kinds, declared cardinality/completeness and criteria/hooks. Source mapping is checked only when source exists. It does not require code for a new idea.

Semantic evaluation runs the existing full defect funnel plus per-kind checks for vague/unmeasurable statements, contradictions, duplicates, inconsistent terms, summary/purpose drift and incompatible boundaries. It also compares authored intent against the resulting nodes for unsupported claims and omitted requirements, using bounded slices and the manifest. It returns uncertainty when intent fidelity cannot be established. Model probabilities are recorded as model confidence, without claims that they are calibrated correctness probabilities.

Reports disclose which subjects and relationships were actually checked. Sampling, context caps and pair pruning cannot masquerade as exhaustive whole-ontology proof. Reuse the current provider factory, including hosted-demo provider policy; fake results are always labeled and cannot satisfy real-provider acceptance evidence.

## Runtime and review contracts

Add an authenticated integrity-run API under the System scope, with bounded input, rate/cost limits, same-System accepted-template resolution and immutable report storage. It supports a reviewed imported snapshot and an immutable `initial-preview` in the existing initialized System DO before remote repositories exist. That preview contains the bounded Genome files, exact package closure, brief, manifest and all hashes. Native package acceptance approves vocabulary only; assembled-Genome agreement is separate. Source-map requirements apply only to nodes attached to genuine source artifacts. After preview agreement, the CLI writes those exact files and sidecars to a Genome repository without provisioning an app repo, then imports it. The server reloads the remote content and verifies the complete snapshot identity against the stored preview. A byte/hash or package mismatch opens a new review; only an exact match may carry forward the prior human agreement. Caller-supplied hashes alone never establish agreement. CLI and browser use this authority for full checks; deterministic offline validation remains available.

Starting a semantic run is explicit. A queued run is created or reused atomically by a key over System, snapshot, template closure, policy, provider/model, questions, thresholds and requested budgets. A run returns a durable ID and exposes queued/running/completed/failed/cancelled state. A leased worker checkpoints each provider batch by state/question/options hashes; retries replay persisted answers and deterministically rebuild funnel progress. Expired leases can be reclaimed; cancellation prevents new calls, and reports explain work completed before cancellation. Calls lost between provider response and persistence can be repeated: do not promise exactly-once paid requests. Retries are bounded and record that uncertainty. Use bounded batch rows (64 KiB each), at most 10 MiB of checkpoints per run, and a 512 KiB report with explicit truncation; durable summaries and retained report identities survive checkpoint expiry. Default to 200 provider calls, with an explicit maximum of 500, and retain existing pair/round/explanation bounds. Identical active requests reuse the same run; an explicit rerun after terminal failure has a new attempt identity and retains earlier evidence. Current review shows stale when the Genome, brief, package pins or policy changes; reports remain available as history. Re-running a changed snapshot creates a new report.

Hard structural blockers cannot be accepted through normal import/proposal review. Semantic needs-review findings require an explicit per-finding human disposition and rationale before agreement; that agreement is recorded separately and does not relabel unknown model judgments as passed. Acceptance uses separate `integrityStatus` and `agreementStatus` (`pending`, `accepted`, `accepted-with-dispositions`, `rejected`). Apply the following rule to both initial imports and amendments:

| Condition | Human disposition and normal acceptance | Recorded outcome |
| --- | --- | --- |
| Structural blocker or incomplete deterministic evaluation | Repair and rerun required; cannot accept. | blocked / pending |
| Completed semantic defect or unknown judgment | Explicit finding disposition and rationale may permit acceptance. | needs-review / accepted-with-dispositions |
| Provider off, transport failure or no semantic run | Save a draft and retry; cannot claim completion of full integrity review. | needs-review / pending |
| Budget exhaustion or partial semantic coverage | Rerun with sufficient coverage, or explicitly accept the report-level coverage limitation with rationale. | needs-review / accepted-with-dispositions |
| Required checks completed with no unresolved findings | Person may agree the exact snapshot. | passed / accepted |

Report-level limitations receive stable IDs for dispositions just like node findings. Dispositions include actor, time, report/snapshot identity and rationale; they never mutate the automated report. Expert import bypasses, if retained for compatibility, must be labeled as unreviewed and cannot claim integrity success.

Accepting a proposal commits only the exact reviewed Genome and report/disposition references. Atomic claims, candidate hashes, stale-head checks and existing criteria gates stay authoritative. A refused staged candidate offers retry, revise and abandon; revision invalidates its prior approval/report and preserves attempt history. Known proposal-wide errors disable acceptance before a remote push. Custom accepted ontology packages work throughout this flow.

## Artyfact's own ontology

The confirmed app issue is missing production state: public Systems lists only Peopling and the system.artyfact model endpoint returns 404. The repository Genome loads locally; fake seeding does not import it into production. The newer merged revision 74ac1ac7 also adds a working build-time site loader; do not undo or duplicate it.

Enrich genome/ from the user's accepted decisions and canonical docs/design, CLI/agent contracts and GRREAT goals. Cover System/Thing boundaries; optional Parts; intent authoring and clarification; native packages and review; structural and semantic integrity; Genome-only Evolutions; Realization plans, Tasks and local agents; unified Review; source/realized/runtime identity; evidence uncertainty; and the actual public/app surfaces. Link existing nodes instead of duplicating vocabulary, preserve IDs/history, and keep proposed functionality distinguishable until implemented.

Validate and review the enriched Genome, then provision/import it as system.artyfact in the existing production namespace through the real CLI/Artifacts path. Inspect existing repo names and heads first. Never overwrite Peopling, repoint unrelated source bindings, upload credentials/local state, or sync an entire dirty working tree. Use a minimal explicit source set and existing reviewed reimport behavior. If an existing self-System/repo appears, reconcile it instead of forcing an overwrite. The production System must link to real source provenance; absent implementation evidence remains unknown.

## Acceptance evidence

1. A fresh plain-language idea produces an inspectable Genome without existing code, Parts or a fake app binding. The brief, assumptions and node-to-source manifest survive export/import; clarifications change the intended nodes without losing user statements.
2. Structural fixtures reject dangling references, illegal containment, wrong relation endpoints, missing required information and invalid criteria. A provisional/incomplete Genome never reports full integrity passed.
3. Real semantic examples expose an internal contradiction, vague criterion, vocabulary drift and an omitted user requirement. Clean controls, uncertain answers and intentionally ambiguous intent are included; report both false alarms and misses. Set no claim of reliability from a single successful example.
4. Provider failure/off, partial coverage, timeout, budget exhaustion and stale hashes produce explicit needs-review or failed run state, never passed. Authorization, scoped package resolution and replay/idempotency have targeted tests.
5. Review can revise or abandon a failed staged candidate, then accept a repaired exact snapshot once. Two concurrent accepts cannot commit twice; subsequent Genome edits invalidate stale checks.
6. Run the complete flow against real infrastructure in isolated example Systems: a small new idea, an amendment to an existing example, and Artyfact's own ontology. Retain sanitized inputs, report IDs, revisions, finding dispositions and exact outcomes. Mock tests and historical benchmark files do not count as this live evidence.
7. On production, Systems lists system.artyfact; its model and readiness load; the app System map renders actual containment and supports entering Things, inspecting relationships and opening integrity findings at desktop and narrow mobile widths with keyboard/reduced-motion checks.
8. Independent review and full repository CI pass on the final integrated revision; all hosted checks are green before any merge. Report implementation, deployment, real-provider evaluation and live acceptance separately. Keep canonical GRREAT tracking current; missing sync credentials/destination remain pending.

## Integration boundaries

One integration owner controls report schemas, authorization, API wiring, policy/status semantics and canonical notes. Bounded work can separate agent/CLI authoring, integrity execution/review recovery, app presentation, and self-Genome/source examples after shared contracts settle. The written implementation plan follows user review of this spec. Use one integration PR, preserve existing user changes, and do not merge or deploy unreviewed product changes as part of design preparation.
