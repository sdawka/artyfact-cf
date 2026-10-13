# 2026-10-13 — Iteration 3 merged; frontend-design pass

Links: [[../execution]], [[../analysis]], [[../roadmap]]. Follows [[2026-10-13-iteration-3]].

## PR #47 merged

PR #47 (`iteration-3`, 104 commits) merged into `main` as `49d5922` at 15:14 UTC with the hosted `verify` check green; no bypass. `main` now carries the ontology engine core, Genome v2, intents, the generic UI and the self-Genome. The production deploy and the Keep in Touch Genome v2 migration (`artyfact init --genome-only --adopt --force`, `docs/deploy.md`) have not run.

## Design pass: decisions

Plan: frontend-design pass over the platform rail, Home and the workspace, so the Genome/Proteome/Phenome vocabulary reads as three views of one System and the concurrency surfaces are impossible to miss. Decided 2026-10-13, one slice per worktree, PRs into `main`.

- D1. Rail groups are headed by the layer name (Genome, Proteome, Phenome) with the job question as a quiet subline; the Overview meters carry the same questions.
- D2. New Review view (`/review`, `g r`, ◧): every candidate, amendment and promotion awaiting a person, composed from CandidateReview, PromotionPanel and AmendmentReview, with a count on the rail.
- D3. Work keeps board, detail, start work, packet and inline review; only promotion moves to Review, and `/work?panel=promote` redirects there.
- D4. Compare leaves the rail; its route, `g x` and "Compare with parent" on Changelog rows stay.
- D5. One shape for "Describe a change": `/work?panel=intent` replaces the board while open, every entry reads "Describe a change", "+ Evolution" is a secondary text button.
- D6. The Thing workspace nav folds into the rail; breadcrumb, switcher and cards stay.
- D7. Home gains a "Needs you" ledger derived client-side from `GET /api/systems`; cards go quiet (one headline sentence, one deploy line) and sort by attention.
- D8. The self-Genome models the platform UI as `screen`, `component` and `affordance` nodes under `genome/thing.platform/grouping.platform.ui/`, with `stepScreen` and `invokes` links; no template vocabulary changes.

Slices: #53 d-rail (D1, D2 shell, D3 redirect, D4), #54 d-review (D2 queue and desk, D3 Work changes, Map overlap chip link, Inspector "Open in Review"), #51 d-intent-thing (D5, D6), #50 d-home (D7), #49 d-self-genome (D8); this slice, d-docs-review, owns the docs and the post-merge read-through.

## Verified

- Observed: #47 merged on green hosted CI; the five slice PRs are open drafts against `main` and report no hosted checks yet. Nothing from the design pass is merged, deployed or verified live.
- Observed: `node validate.mjs docs/grreat` reports 7 records valid after this entry and the Now update.

## Pending

- W1 merges (#53 first, then #54, #51, #50, #49) on green CI, then `docs/design/ui.md` reconciled end to end against the merged code and an independent read-through across slice boundaries.
- Production deploy and the Genome v2 migration, then live verification; wait out Durable Object version skew after the deploy.
- Screenshots `work-conflict`, `amendment-violation` and `amendment-deliberate` in `docs/images/` retaken on the new Work card and the Review view (see `docs/video-script.md`).
