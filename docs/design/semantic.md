# Appendix E — System One question catalog (packages/semantic)

All questions over one `state` object per call; independent questions batched; ids are code-only, so instructions carry full meaning. Thresholds: pass/fail at ≥0.9/≤0.1 for verdict-bearing hooks; review band 0.5–0.9; Choice confidence < 0.5 → `unresolved-interpretation` regardless of top option.

## E.1 Genome amendment review (`reviewDelta`) — per changed/added node or requirement
state: `{ system: {id, purpose: P1 text}, commitments: [{id, statement}], change: {id, kind, before, after, fieldsChanged}, governing: {criteria: [...titles+claims], requirements: [...]} }`
- `changeClass` **Choice**: "Classify this Genome change relative to the System's accepted contract." criteria: `deliberate-nonstandard-choice` "an unusual but coherent product decision that contradicts no accepted hard rule", `unresolved-interpretation` "ambiguous or underspecified; could be read two ways", `hard-rule-violation` "contradicts an accepted criterion, requirement or commitment listed in `governing`/`commitments`", `clarification` "wording or structure only; meaning unchanged".
- `contradicts.<commitmentId>` **Noul** ×N: "Does `change.after` contradict commitment `<id>`: '<statement>'?" true/false criteria spelled out.
- `weakens` **Noul**: "Compared with `change.before`, does `change.after` weaken, remove or make untestable an obligation in `governing`?"
- `specificity` **Score** 0–3: 0 "aspirational, no observable condition", 1 "observable but no scope/role/state", 2 "observable with scope, missing failure behaviour or limits", 3 "fully testable: scope, condition, failure behaviour, limits".
- `touchesConsent` **Noul**: "Does this change alter who may see or act on another person's data, or the consent needed?" (routes to privacy/consent packs + admin attention).

## E.2 Topology (`topology`) — per `semanticCandidate` tuple
state: `{ node: {id, kind, name, effects, fields}, profile: "private-pairs: exactly one recipient per outgoing direct action; no recipient lists, bulk send or group threads" }`
- `multiRecipient` **Noul**: "Does this operation/affordance send or address one action to more than one person at once?"
- `isPublication` **Noul**: "Is this a reader-driven publication (author publishes, approved readers independently read) rather than a direct send?" (the digest interpretation question from the example spec).

## E.3 Purpose measures (`purposeMeasures`) — per Theory claim, hook for `C.system.purpose` model binding
state: `{ purpose: P1, claim: {id, mechanism, outcome, indicator, evaluationMethod, limitation} }`
- `engagementSubstitute` **Noul**: "Does the indicator measure app engagement (time, volume, opens) *as if* it were the wanted outcome?"
- `outcomeNotOutput` **Noul**: "Does the outcome describe a change for the beneficiary rather than a delivered feature?"
- `measurable` **Score** 0–2: 0 "no way to observe", 1 "observable with a stated method", 2 "observable with method, population and time window".

## E.4 Interference (`interference`) — per overlapping candidate pair
state: `{ a: {evolution, changedSubjects, summary}, b: {...}, shared: overlap() result, journeys: [...names], criteria: [...] }`
- `interferes` **Noul**: "Would applying both changes together alter a shared user journey or an outcome hypothesis in a way neither change alone intends?"
- `needsComposition` **Noul**: "Must these two changes be tested together as one composition rather than independently?"

## E.5 Capture assist (`classifyStatements`, stretch) — per sentence of a narrative
- `kind` **Choice** over NodeKind + `commitment` + `hypothesis` + `none`; `attachTo` **Choice** over the top-k candidate node ids from a lexical prefilter (+ `new`); `isDistinctiveChoice` **Noul** "Is this a deliberate, non-generic design commitment worth preserving verbatim?" Output = reviewable proposals with probabilities; nothing is written without acceptance.

## E.6 Provider + fake
`createSystemOne(env)`: `TYPESAFE_API_KEY` → `https://api.typesafe.ai`, model `jev-latest`; else `OPENROUTER_API_KEY` → `https://openrouter.ai/api`, model `jev-1.13`; `FAKE_S1=1` → canned answers honouring `#s1low` / `#s1no` / `#s1pick:<key>` directives in state (copied behaviour from bropilot); else `off` → every judgment `unknown` with `provenance.provider = 'off'`. Use the SDK (`@typesafe-ai/sdk`, `TypeSafeClient({apiKey, baseURL, defaultModel, timeout: 2500, retry: {maxRetries: 1}})`) if it runs in workerd; otherwise raw `fetch` to `/v1/systemone` with the documented body — the wrapper hides which.
