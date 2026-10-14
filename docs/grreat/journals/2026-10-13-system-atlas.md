# System atlas

## 2026-10-13T19:02:43-04:00 — Approved direction into execution

- Goal: [[goals]]. Milestone: [[roadmap]] (`roadmap.next`).
- Decision: Map opens every System at environment, superseding the single-Thing default; actual containment, a stable content-sized mosaic and quiet selection with on-demand Details are the enduring contracts in [UI](../../design/ui.md) and [decision log](../../decision_log.md).
- Work: updated canonical UI, acceptance criteria and [[execution]] Now while projection/layout, interaction and routing implementation proceed on `feat/system-atlas`. No implementation or deployment verification is claimed at this checkpoint.
- Evidence and remaining gap: `node /Users/sdawka/.agents/skills/grreat-project/validate.mjs docs/grreat` passed (7 records). Versioned direct-RPC `--dry-run` returned `pending / missing_credentials`, 0 applied; no destination was established and no remote writes occurred. No `.sync.json` exists in this worktree or the original checkout. Integrated local checks, independent review and hosted CI remain pending. The separate Artyfact/Bropilot planning boundary still applies.

## 2026-10-13T22:37:34-04:00 — Verified atlas release

- Result: environment-first entry, real containment mosaic, quiet selection/explicit Details and polished preference-gated motion are released. All independent findings were addressed, including camera replay and the minimum 216px footer overlap; the stale ambient-glow test expectation was corrected and reviewed.
- Gates: final pre-push passed all five platform steps in 150.4s: 2564 unit tests, 74 fixture and 13 fake browser cases, no retries. Hosted [run 38500841963](https://github.com/sdawka/artyfact-cf/actions/runs/38500841963) succeeded on exact head `27dc6fbdc8521a651d75f4d71ff616760cc5fa7e`; [PR #66](https://github.com/sdawka/artyfact-cf/pull/66) merged at 2026-10-14T02:32:57Z as `4bc93a811f2251ec949e060e98d6bf4d081d8fbf`.
- Deployment: built, dry-run and deployed that merged revision to [artyfact-platform](https://artyfact-platform.dawka.workers.dev), Worker version `83e29bb9-0f2e-42c2-892a-a8aa496bf46b`. Parent health check returned HTTP 200/ok.
- Live evidence reported by the primary: authenticated read-only Peopling smoke passed at 1440×900 and 390×844. Health/System list/model returned HTTP 200; environment, containment, Details, history/pan restoration, explicit Thing Map, Work/Deployments headings and reduced motion passed. Five inspected screenshots/states had zero serious/critical axe findings; body overflow, blocked writes, mutations and page errors were all zero. The initial harness field mismatch was corrected without a product change. Evidence is in the ignored `production-smoke.log` under `.superpowers/sdd/system-atlas/`.
- Residual: direct-RPC sync remains `pending / missing_credentials`, 0 applied; the separate Artyfact destination is unconfirmed. Canonical Markdown remains authoritative.
