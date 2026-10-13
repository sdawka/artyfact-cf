# Keep in Touch System

Worked example System `system.keep-in-touch`, encoded as the Genome v2 node tree that `@artyfact/model` `loadGenome()` loads.
Source: `docs/source/keep-in-touch-world-specification.docx`. Phase: unrealized.

One directory per node, each with its `node.yaml`; a node's children are its subdirectories. Nodes map app paths with `files` globs
(there is no `source-map.yaml`): the platform cuts a task packet's permitted paths from the affected nodes' globs and answers
"which nodes did this candidate touch" from them. `npx artyfact init --genome examples/keep-in-touch-system --app examples/keep-in-touch-app` imports it.

| Path | Spec section |
| --- | --- |
| `node.yaml` | 1 System identity, 7 Kits and Rule Packs (auth Kit required but unpinned on purpose) |
| `P1/`, `section.purpose/` | 1 Purpose P1 |
| `ext.*/`, `section.externals/` | 2 Externals and boundary |
| `GD.*/`, `commitment.*/`, `section.description/` | 3 General Description (narrative, GD.*, commitments, digest question) |
| `T1/`-`T5/`, `section.theory/` | 4 Theory T1-T5 and the evaluation protocol |
| `thing.webapp/` | 1 Thing and Artifacts (template `cloudflare-worker-webapp@1`), 6 `S.webapp.*` requirements, its sections and nodes |
| `J.updates/`, `thing.webapp/J.*/`, `evolutions/*.yaml` | 9 Journeys and Evolutions; criteria are declared on the nodes they assess |

The unpinned authentication Kit is an intended readiness finding. The template's provisional `binding.d1`
stays as shipped; `binding.contactsStore` is the Thing's intended D1 binding.

Run `npm test -w @artyfact/example-keep-in-touch-system` or `npm test` from the repo root.
