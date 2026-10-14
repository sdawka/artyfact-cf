# Lifecycle port

- Supports [[goals]], [[roadmap]], [[execution]] and [[analysis]].
- Decision: the task-planning work on `tasks-integration` is ported file by file onto the released [lifecycle](../../design/lifecycle.md) rather than merged. Evolutions change only the Genome; implementation is Realization plan, Tasks, then attempts. Evolution-scoped plans, mixed Evolutions, start-wave and rebase are not carried over; a moved binding means replan.
- Ported: planner draft (`POST …/realization-plans/draft`, only promoted plans count as realized), lifecycle packet fields and mode-preserving integrate, System import review with guards, proposal agreement tree with decisions and deferral, `artyfact plan draft|tasks` and stored task tokens, the plan wave board and agreement and import-review views, Peopling goal and event data.
- Docs: `docs/design` backend B.6, B.9 and B.10, ontology §4 and §5, ui C.6 to C.7a and model A.2 follow the code. The demo runbook and video script follow the new flow; the site guide describes `task claim` and the stored token.
- Verified: plan draft to promote walked on the fake platform with the real CLI (Peopling waves `[[t1,t2],[t3]]`, dependent claim refused until selection). Import review, deferral and the real-Cloudflare steps were not walked on this branch. Remaining integration and CI belong to the port's integration slice.
