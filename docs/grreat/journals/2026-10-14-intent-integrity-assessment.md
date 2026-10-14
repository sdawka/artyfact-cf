# Intent and ontology integrity assessment — 2026-10-14

Supports [[../goals]] and [[../execution]]. Read-only product assessment at `95afff62`; the user prioritized intent-to-ontology, including external local-agent authoring, followed by ontology integrity. Direction is recorded in [the decision log](../../decision_log.md).

- Existing intent proposals amend an imported Genome. The shipped Genome-authoring skill describes existing code and excludes planning new features; a complete greenfield intent-authoring journey needs explicit guidance and evidence.
- Static parsing, template/reference rules, review and candidate pinning exist. Normal readiness and import review do not run the full semantic defect funnel. CLI `ok` means no errors, and does not establish completeness or intent fidelity.
- Fresh local validation: Artyfact has 456 nodes and no reported findings; Peopling has 245 nodes with 6 provisional/missing, 14 unbound-hook warnings and 1 unpinned-kit warning, yet returns `ok: true`. Neither run supplied `--app`, so no source-coverage claim. Workerd ontology smoke passed 2 tests using fake providers after a sandbox-blocked first attempt.
- Focused verification passed 202 tests: 66 intent Worker, 40 model/CLI/import-review, 94 ontology evaluation/check/probe and 2 Worker smoke. Code tracing also found that staged gate refusals block proposal edits while no public intent-abandon route exists; this recovery gap was not reproduced end to end.
- Recorded real-provider evaluations from October 13: complete shortlist-first routing hits 13/24 Tidepool and 7/10 assistant requests; translation precision 0.67/0.86 and recall 0.64/0.67. Semantic judging on 26 planted defects returned 13 confident detections, 12 for review and 1 miss; controls also produced review uncertainty.
- Production evidence establishes Peopling import/readback and an OpenRouter implementation-plan draft. That import explicitly used `--no-review`; it does not prove the reviewed intent-to-ontology loop. No new live provider calls or production writes were performed for this assessment.
- Next: prove a fresh plain-language idea through clarification, agent-authored ontology, structural and semantic integrity findings, repair and human agreement on an isolated real example before advancing downstream work.
- Tracking: canonical validation passed (7 records); versioned RPC preview returned `pending: missing_credentials`, applied 0. The separate-destination constraint and prior conflict remain unchanged.

## Design preparation — 2026-10-14T15:29:14-04:00

- User approved the foundation scope and clarified that self-ontology loading fails in the app System map. Read-only production checks found only Peopling in Systems and HTTP 404 for system.artyfact/model; local self-Genome loading succeeds. This supports a missing production import, rather than a demonstrated loader defect.
- The isolated worktree starts from newer merged 74ac1ac7, preserving its site self-Genome loader, hosted-demo provider policy and visual-check changes. The original checkout and user files remain untouched.
- [Proposed design](../../design/intent-integrity.md) is ready for user review. No product implementation, production write, deployment or live model call was performed during design preparation.
