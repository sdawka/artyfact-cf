# @artyfact/semantic

Question catalogue, threshold policy and judgments for System One. The client is the engine's (`@artyfact/ontology`): one `SystemOne` type, one LRU cache, one provenance shape. The model proposes; deterministic policy decides. Keys are server-side only.

## Modes

`createSystemOne(env)` is the engine's `providerFromEnv` and picks a provider in this order:

| Provider | When | Endpoint / model |
| --- | --- | --- |
| fake | `FAKE_S1=1` | canned answers, no network |
| TypeSafe | `TYPESAFE_API_KEY` | `https://api.typesafe.ai/v1/systemone`, `jev-latest` |
| Clef | `AI` (Workers AI binding) | `env.AI.run("@cf/cloudflare/clef", …)`, or `CLEF_MODEL`; reads images |
| OpenRouter | `OPENROUTER_API_KEY` | the Decisions API, `OPENROUTER_MODEL` or `perplexity/pplx-decider-v1.1-27b` |
| off | none of the above | every judgment is `unknown`, `provenance.provider = 'off'` |

`createVisionSystemOne(env, selected?)` is the provider for screenshot judgments. It returns `selected` when that provider reads images, else Clef when `AI` is bound, else `selected`, which refuses images with an `unsupported` `S1Error`. `visualCriterion(s1, subject, images)` asks whether labelled screenshots satisfy a criterion's claim. It accepts at most 4 PNG, JPEG or WebP images per ask, each up to 4 MiB and 8 MiB in all, and the images are hashed into the cache key.

`env` also accepts `fetch` for injection in tests. Timeouts, 429 and 529 (OpenRouter: 5xx) are retried; other failures throw `S1Error`. Replies are cached in memory (200 entries, LRU) under `cacheKeyFor(state, questions, model)`. The `judgments.*` functions never throw: failures become `verdict: 'unknown'`, `level: 'info'`, `provenance.provider: 'error'`.

Fake directives, matched anywhere in `JSON(state)`: `#s1low` (low confidence), `#s1no` (noul 0.05, choice `none` or the last option, score 0), `#s1pick:<key>` (choice key), `#s1harm` (every noul a confident yes), plus the engine's per-question `#s1:<id>=<answer>`. Without directives, every question gets the `benign` answer its catalogue entry declares, so a benign Genome passes. `benign` is stripped before a question goes on the wire. Fake answers ignore the evidence, and every evaluation built on them carries `provenance.provider: "fake"`.

## Thresholds

- `verdict(p)`: `pass` at >= 0.9, `fail` at <= 0.1, otherwise `unknown`.
- `band(p)`: `act` >= 0.9, `review` >= 0.5, otherwise `abstain`.
- `choiceOutcome`: Choice confidence < 0.5 gives `unresolved-interpretation` whatever the top option.
- `reviewDelta` level: hard-rule-violation probability or any `contradicts` >= 0.9 is `error`; those >= 0.5, or `weakens` >= 0.5, is `warning`; otherwise `info`. `verdict` is `fail` on error, `pass` only when every harmful signal is <= 0.1 and the class is `clarification` or `deliberate-nonstandard-choice`, else `unknown`.

Never green under threshold: nothing in the 0.1 to 0.9 band, and nothing from an off or failed provider, ever yields `pass`. Verdicts on a proposition (`topology`, `interference`) mean "the proposition holds", so `pass` is a confirmed multi-recipient or confirmed interference.

## Judgments

`reviewDelta`, `topology`, `purposeMeasures`, `interference`, `classifyStatements` (see `docs/design/semantic.md`, Appendix E). Each result carries the engine's `Provenance`: `{provider, model, questionHash, stateHash, thresholds, ms, usage, error?}`.

## Adding a question

1. Add it to the relevant builder in `src/questions.ts`. Ids are never sent as meaning, so the instructions and criteria must be self-contained; keep Choice descriptions <= 255 chars and include no-match options.
2. If the state needs new fields, extend the matching `*State` builder.
3. Read the answer in `src/judgments.ts` with `noul` / `choice` / `score` and map it through `policy.ts`.
4. Document it in Appendix E and add a test (fake directives drive both branches).

`src/model-types.ts` holds local structural types; switch to `@artyfact/model` imports once it exports them.

## Tests

`pnpm --filter @artyfact/semantic test`. `test/live.smoke.test.ts` runs only when `ONTOLOGY_LIVE=1` and `TYPESAFE_API_KEY` are both set.
