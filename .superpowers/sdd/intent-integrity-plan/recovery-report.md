# Task 3 recovery report

Implemented proposal recovery on `feat/intent-ontology-foundations`.

- Added admin `POST /api/systems/:id/intents/:pid/revise` with `{candidateId, commit, answer, questionId?}` and `POST .../:pid/abandon` with `{candidateId, commit, reason}`.
- Recovery claims the exact staged candidate, rejects its realization, archives the staged approval and integrity binding in `Proposal.attempts`, and either atomically installs the revision or abandons the proposal.
- Proposal-wide deterministic errors and missing/malformed integrity agreement input are rejected before remote push. Intent-authored candidates bind the server-computed exact snapshot to an eligible integrity run; legacy candidates without intent sidecars remain compatible.
- Intent head loading and proposal simulation now use the System's accepted custom template resolver and digest-aware memo key.

Evidence:

- Reproduced before implementation: four focused tests failed because proposal-wide errors returned 201 and recovery routes returned 404.
- `npx vitest run apps/platform/test/intents.test.ts --reporter=dot`: 77 passed.
- `npm run typecheck -w @artyfact/platform -- --pretty false`: passed.
- `git diff --check`: passed.

Code tracing confirmed the original staged path released the proposal to `open` while `replyProposal` and `decideProposal` both rejected `stagedApproval`, and no public route called the existing internal abandonment path. Tests reproduce the resulting recovery behavior, exact candidate fencing, one-winner recovery claim, pre-push refusal, history retention and fresh-attempt evidence invalidation.
