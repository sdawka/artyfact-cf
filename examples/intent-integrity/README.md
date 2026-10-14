# Intent integrity examples

These sanitized, source-free inputs are controls for the intent-to-Genome and
integrity flow. They intentionally contain no repository URL, credentials,
personal data, or application source. Each case now includes `ontology-package.json` and an actual source-free `genome/`
with canonical intent sidecars. `expected-findings.json` records hypotheses to
check, rather than claimed provider results. The executable regression loads
these Genomes, checks their provenance, and reproduces the flawed reference.

- `new-idea`: a small new System with an open consequential question.
- `amendment`: a change to an existing example whose provenance stays explicit.
- `flawed`: deliberate structural, vocabulary and intent-coverage defects.
- `clean`: a control with explicit boundaries and measurable acceptance.
