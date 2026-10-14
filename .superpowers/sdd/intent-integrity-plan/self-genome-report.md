# Task 6 — self-Genome and representative examples

Status: base semantic model and fixtures complete locally; endpoint, command and
app-surface node mappings await their owning slices' exact public contracts.

- Added `feature.intent-integrity`, `J.author-intent`, and commitments for
  intent fidelity and integrity review. The feature is explicitly proposed;
  automated integrity never stands in for human agreement.
- Enriched `system.artyfact` with the source-free Genome and separate
  source/realized/runtime identity boundary. No production import claim is made.
- Added `genome/intent/brief.md` and `genome/intent/manifest.json`. The manifest
  maps five stable node IDs to canonical `docs/decision_log.md` and design
  documents using exact SHA-256 hashes.
- Added source-free controls under `examples/intent-integrity/`: `new-idea`,
  `amendment`, `flawed`, and `clean`. The flawed control declares a dangling
  reference, boundary contradiction, vague criterion, omitted intent, and
  vocabulary drift; controls are sanitized and contain no secrets or URLs.

Validation: `npm test -w @artyfact/templates -- test/self-genome.test.ts`
passed (13 tests) after a red run demonstrated missing semantic nodes and
sidecars. The focused suite validates the loaded Genome, source mapping, exact
document hashes, sidecar bounds, and fixture status/finding declarations.

Before final integration, refresh manifest document hashes if cited canonical
documents changed:

```sh
for f in docs/decision_log.md docs/design/intent-integrity.md docs/design/ontology.md docs/design/model.md; do
  printf '%s sha256:' "$f"
  shasum -a 256 "$f" | awk '{print $1}'
done
```

Replace only the corresponding manifest hashes and rerun the focused suite.
