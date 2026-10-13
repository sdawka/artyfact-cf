# System atlas

## 2026-10-13T19:02:43-04:00 — Approved direction into execution

- Goal: [[goals]]. Milestone: [[roadmap]] (`roadmap.next`).
- Decision: Map opens every System at environment, superseding the single-Thing default; actual containment, a stable content-sized mosaic and quiet selection with on-demand Details are the enduring contracts in [UI](../../design/ui.md) and [decision log](../../decision_log.md).
- Work: updated canonical UI, acceptance criteria and [[execution]] Now while projection/layout, interaction and routing implementation proceed on `feat/system-atlas`. No implementation or deployment verification is claimed at this checkpoint.
- Evidence and remaining gap: `node /Users/sdawka/.agents/skills/grreat-project/validate.mjs docs/grreat` passed (7 records). Versioned direct-RPC `--dry-run` returned `pending / missing_credentials`, 0 applied; no destination was established and no remote writes occurred. No `.sync.json` exists in this worktree or the original checkout. Integrated local checks, independent review and hosted CI remain pending. The separate Artyfact/Bropilot planning boundary still applies.

## 2026-10-13T19:35:34-04:00 — Locally verified atlas

- Result: environment-first System entry, actual containment mosaic, quiet selection with explicit Details, stable geometry and top-level Map before Overview are implemented on `feat/system-atlas` at `f580724`, with [PR #66](https://github.com/sdawka/artyfact-cf/pull/66) open. All independent review findings were addressed; source review passed. The primary inspected desktop environment/System mosaic and mobile screenshots; the exact camera replay diagnostic and browser regression passed.
- Verification reported by the primary: `npm run ci` exited 0; all 10 steps passed in 204.8s. Root unit tests: 2559 passed, 9 skipped across 207 passing files, 5 skipped. Fixture browser: 68 passed first try, plus 1 passed on retry; fake platform: 13 passed. Site units: 55 passed; static build passed; site browser: 51 passed, 5 skipped. Both typechecks and builds passed. The normal pre-push subsequently passed in 157.6s with all 69 fixture browser cases passing first try.
- Next action: review PR #66; hosted CI status is tracked authoritatively on the PR and all checks must be green before merge; no atlas deployment is claimed. Direct-RPC preview remains `pending / missing_credentials`, 0 applied; the separate Artyfact destination is unconfirmed and no remote writes occurred. Canonical Markdown remains authoritative.
