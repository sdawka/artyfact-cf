# scripts

`bootstrap.sh [--dry-run]` creates (or reuses) the Artifacts namespace `artyfact` and repos `kit-system` and
`kit-app`, then pushes `examples/keep-in-touch-system` and `examples/keep-in-touch-app` to `main`.
A repo that already has `main` is left alone. Requires `wrangler` logged in; `ACCOUNT_ID` is read from the
environment or `wrangler whoami`. Tokens are never printed. `--dry-run` only prints the commands.
`ARTIFACTS_NAMESPACE`, `GENOME_REPO` and `APP_REPO` override the names (the integration test uses them).
A missing namespace is created with `cf artifacts namespaces create --namespace <ns>` (`cf` has its own login).
The demo, end to end, is in `docs/demo-runbook.md`.
