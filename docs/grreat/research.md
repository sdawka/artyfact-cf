<!-- grreat:record id=research.current kind=research status=active parent=goal.north-star -->
# Current implementation baseline

- Informs: [[goals]] and [[roadmap]].
- Inspected baseline: `5614e64062911bb67ddb2244132142da319e1fec`, refreshed after the earlier planning baseline advanced.
- Sources: [model design](../design/model.md), [backend design](../design/backend.md), [UI design](../design/ui.md), and their referenced implementation files.
- `packages/model` resolves one legacy template per owner and globally indexes IDs. Same-ID replacement is too implicit for overlapping reusable packages. Artifact validation currently prevents Genome-only Things.
- Platform home lists Systems only; Thing focus is an inspector rather than a complete workspace. There is no Parts registry.
- Build/deployment records describe commits and builds without a first-class realized output; Phenome ingestion does not establish Thing/artifact ownership from authoritative lineage.
- `packages/cli` owns local authoring. Existing `compose` concerns realizations and must remain compatible; new package verbs live under `parts`.
- Public `/`, `/model`, and `/connect-agent` need aligned definitions and truthful CLI guidance. Genome, Proteome, and Phenome remain views, not sequential stages.
- Recent behavior to preserve: invalid Genome files remain inspectable; acceptance criteria selection respects target/scope; changelog links/counts both Genome and application changes.
- Assumption: existing versioned templates remain supported while new Parts use explicit immutable versions. Source artifacts exclude dependencies, caches, and build output.
