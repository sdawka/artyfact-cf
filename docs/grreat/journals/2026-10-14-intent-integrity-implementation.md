# Intent and ontology integrity implementation — 2026-10-14

Supports [[../goals]], [[../roadmap]] and [[../execution]]. Implementation follows the approved [design](../../design/intent-integrity.md) and [plan](../../design/intent-integrity-plan.md) on `feat/intent-ontology-foundations`, [PR #80](https://github.com/sdawka/artyfact-cf/pull/80).

- Implemented: canonical intent sidecars and exact snapshots; durable structural/semantic runs and agreement; proposal revise/abandon recovery; agent-led CLI authoring/check/agreement/materialization; Start and Review flows; enriched self-Genome and four executable native examples.
- Review repairs: valid slash IDs, meaningful semantic provenance, recovery lease takeover and CLI native artifact discovery. Independent backend review is now checking crash recovery and preventing silent unreviewed intent imports; CLI upload allowlisting is also being tightened.
- Local evidence: model 158 tests, intents 78, backend/import integration 105, UI 18 and self-Genome 14 passed in their scoped checks. Primary native example tests pass 4/4. Combined full CI is running; scoped results are not release clearance.
- Private live harness: native template package accepted, clean snapshot created without static findings; flawed snapshot completes with a real `ref.dangling` structural blocker and explicitly incomplete provider-off semantics. No fabricated app/Part bindings were needed.
- Real-provider verification is pending specific TypeSafe destination approval after automatic approval review blocked transmission. The hosted demo intentionally simulates models and cannot supply real-provider acceptance. No production import or deployment has occurred.
- Remaining: independent review repairs, full local/hosted CI, live provider examples, exact self import and production desktop/mobile verification. GRREAT sync remains pending credentials and a confirmed separate Artyfact destination; preserve the earlier wrong-project conflict.
