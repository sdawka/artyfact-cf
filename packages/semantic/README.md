# @artyfact/semantic

Thin client, question catalogue, threshold policy and provenance for TypeSafe System One (Jev). The model proposes; deterministic policy decides. Uses `fetch` and WebCrypto only, so it runs in Node and Cloudflare Workers. Keys are server-side only.

## Modes

`createSystemOne(env)` picks a mode in this order:

| Mode | When | Endpoint / model |
| --- | --- | --- |
| `fake` | `FAKE_S1=1` | canned answers, no network |
| `typesafe` | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone`, `jev-latest` |
| `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1/systemone`, `jev-1.13` |
| `off` | none of the above | every judgment is `unknown`, `provenance.provider = 'off'` |

`env` also accepts `fetch` for injection in tests. `ask(state, questions, {timeoutMs = 2500, retries = 1, backoffMs = 200, cacheKey})` retries once on timeout, 429 and 529; other failures throw `S1Error`. Successful live replies are cached in memory (200 entries, LRU) under `cacheKeyFor(state, questions, model)`, which a Worker can reuse to persist replies. The `judgments.*` functions never throw: failures become `verdict: 'unknown'`, `level: 'info'`, `provenance.provider: 'error'`.

Fake directives, matched anywhere in `JSON(state)`: `#s1low` (low confidence), `#s1no` (noul 0.05, choice `none` or the last option, score 0), `#s1pick:<key>` (choice key), `#s1harm` (every noul a confident yes). Without directives, noul questions whose yes means harm (`engagementSubstitute`, `weakens`, `contradicts.*`, `multiRecipient`, `isPublication`, `interferes`, `needsComposition`) answer a confident no, so a benign Genome passes; the rest answer yes.

## Thresholds

- `verdict(p)`: `pass` at >= 0.9, `fail` at <= 0.1, otherwise `unknown`.
- `band(p)`: `act` >= 0.9, `review` >= 0.5, otherwise `abstain`.
- `choiceOutcome`: Choice confidence < 0.5 gives `unresolved-interpretation` whatever the top option.
- `reviewDelta` level: hard-rule-violation probability or any `contradicts` >= 0.9 is `error`; those >= 0.5, or `weakens` >= 0.5, is `warning`; otherwise `info`. `verdict` is `fail` on error, `pass` only when every harmful signal is <= 0.1 and the class is `clarification` or `deliberate-nonstandard-choice`, else `unknown`.

Never green under threshold: nothing in the 0.1 to 0.9 band, and nothing from an off or failed provider, ever yields `pass`. Verdicts on a proposition (`topology`, `interference`) mean "the proposition holds", so `pass` is a confirmed multi-recipient or confirmed interference.

## Judgments

`reviewDelta`, `topology`, `purposeMeasures`, `interference`, `classifyStatements` (see `docs/design/semantic.md`, Appendix E). Each result carries `provenance: {provider, model, questionHash, stateHash, ms, usage}`.

## Adding a question

1. Add it to the relevant builder in `src/questions.ts`. Ids are never sent as meaning, so the instructions and criteria must be self-contained; keep Choice descriptions <= 255 chars and include no-match options.
2. If the state needs new fields, extend the matching `*State` builder.
3. Read the answer in `src/judgments.ts` with `noul` / `choice` / `score` and map it through `policy.ts`.
4. Document it in Appendix E and add a test (fake directives drive both branches).

`src/model-types.ts` holds local structural types; switch to `@artyfact/model` imports once it exports them.

## Tests

`npm test -w @artyfact/semantic`. `test/live.smoke.test.ts` runs only when `TYPESAFE_API_KEY` is set.
