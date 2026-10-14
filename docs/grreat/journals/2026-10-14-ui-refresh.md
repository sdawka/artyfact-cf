# UI refresh — 2026-10-14

Evolved the Whimsy identity across the platform and site without changing it: apricot became the operator's colour (where you are, what you can do, what waits on you) and the hierarchy was fixed page by page. Context: [[../goals]], [[../execution]].

- **Audit.** Eight page audits and one design brief merged into one approved plan: 33 pages and states, 10 real defects (Changelog overflow, Compare's wrong "identical" sentence, Code's empty commit sheet, ✓ kind glyphs beside unknown verdicts, Promote buried under the form, no 404, Work's clipped board, Deployments claiming absence on API failure, unstyled `aria-pressed`, a self-Genome that described behaviour the code lacked) and one cross-page rules table.
- **Decisions a–j, all accepted as recommended.** a Atkinson Hyperlegible Next/Mono with Alegreya display; b Home and site practices become registers; c Work becomes list and detail with state groups; d site story moves second; e Theory defaults to a claim list; f Thing-scoped Work, Review and Deployments filter to the Thing with "Show all"; g Private Parts keeps its own token field; h Inspector tabs Links and Rules; i j/k/Enter in the Review queue; j `/connect-agent` h1 "Bring your agent.".
- **W0 foundation** (`39f29957`): fonts in both apps, role type and surface tokens, attention, link and disabled-primary tokens, selection and status glow, the selection rule, and primitives (PageHeader, Section, Panel, ListDetail, RowList/Row, MetaLine, StatusText, Count, Kbd, Steps, Button reason, EmptyState kinds), plus a token-parity test and a seeded build, deployment, event and evaluation.
- **W1, eight parallel slices** on branch `ui-refresh`: shell, home and entry (Start wizard, NotFound/RouteError), atlas, repo, work, decide (Review desk, two screens below 900px), run (Overview, Deployments, Thing) and site. Merged locally into `ui-refresh` at `9e2cfa08`.
- **Process slip.** Under crunch-mode rules two slice branches were pushed with `--no-verify` before that allowance was retracted after a classifier flag; from then on slices merged locally only, with no bypassed hooks.
- **W2 records** (branch `r-w2docs`): the self-Genome UI nodes were rewritten against the shipped code, which was checked view by view (code wins over the slices' reports). Added `screen.start`, `screen.not-found`, Work's plan, wave and Copy all, Review's import, Task result and plan review, and the Map's Details, Outside and Connections. Removed nodes for things that no longer exist: Home's Review pill, Publish part, Create deployment, Issue ingest token, Overview's Open Map and Open Deployments, Map's Candidates toggle, Journeys' step-screen link and Back to board. Journey steps now point import and accept-import at Start and the overlap step at Review. `docs/design/ui.md` now carries the rules table, page grammar and archetypes, and the per-view sections.

## Verification

`npm test -w @artyfact/templates -- test/self-genome.test.ts` passes 10 tests with info-only (semantic) findings; the ontology, generic-template, model-validation and site how-it-works suites pass (77 + 6). Full CI, the cross-slice review against the rules table and before/after captures have not run yet; they belong to the integration PR.

## Code follow-ups found while recording

- Per-form admin token fields remain in Deployments' Operations gate and, while the header token is unset, in the promotion, amendment and import Decision forms, against the "header is the one source" rule.
- Thing scope wording differs: ThingScopeNote reads "Showing {Thing}" / "Showing everything in this System" (its doc comment says "Showing all of the System"), while Work reads "Showing changes to {Thing}." / "Showing all of this System." with "Only {Thing}".
- Theory still renders "Theory gaps" when findings exist, and Changelog keeps "Compare with parent"; both are now recorded as shipped.
- "Add to promotion" stays the same label when pressed; "Added to promotion" appears only as the selection heading.
- Journeys' step screen and operation chips are not links; the Inspector's Open in links carry that navigation.

## GRREAT

The vault validates: 7 records. The authenticated versioned RPC dry-run reached `ws_bddc55cbf3e14dc8b8c22e651e82a8fd`, proposed 6 creates and 5 relation changes, and applied 0 with no conflicts. That workspace is still not confirmed as a separate Artyfact destination, so no apply was sent. Sync stays pending, and the earlier wrong-project conflict stays visible.
