# Keep in Touch System

Worked example System `system.keep-in-touch`, encoded as the YAML Genome that `@artyfact/model` `loadSystem()` loads.
Source: `docs/source/keep-in-touch-world-specification.docx`. Phase: unrealized.

| File | Spec section |
| --- | --- |
| `system.yaml` | 1 System identity |
| `purpose.yaml` | 1 Purpose P1 |
| `externals.yaml` | 2 Externals and boundary |
| `description.yaml` | 3 General Description (narrative, GD.*, commitments, digest question) |
| `theory.yaml` | 4 Theory T1-T5 and the evaluation protocol |
| `kits.yaml` | 7 Kits and Rule Packs (auth Kit required but unpinned on purpose) |
| `things/webapp/thing.yaml` | 1 Thing and Artifacts, template `cloudflare-worker-webapp@1` |
| `things/webapp/spec.yaml` | 6 `S.webapp.*` requirements |
| `things/webapp/ontology.yaml` | 5 entities, 6 screen and operation tables, policies, bindings |

Criteria, journeys and evolutions (sections 7 and 9) live in sibling files owned by a separate slice.

The unpinned authentication Kit is an intended readiness finding. The template's provisional `binding.d1`
stays as shipped; `binding.contactsStore` is the Thing's intended D1 binding.

Run `npm test -w @artyfact/example-keep-in-touch-system` or `npm test` from the repo root.
