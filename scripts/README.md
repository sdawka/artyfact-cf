# scripts

`bootstrap.sh [flags]` is a wrapper over `npx artyfact init --genome examples/peopling-system --app examples/peopling-app`.
Flags pass through (`--adopt`, `--force`, `--platform <url>`, `--namespace <ns>`). `init` derives `peopling.genome` and
`peopling.app` from the System id, creates the namespace and the `platform` repo when missing, pushes with short-lived
tokens, and imports with `ARTYFACT_ADMIN_TOKEN`. Details: `packages/cli/README.md`. The demo, end to end, is in `docs/demo-runbook.md`.

`ci.mjs` is the CI definition: `pnpm run ci` runs every job, `--changed` only the affected ones, `--job <unit|e2e-fixture|e2e-fake|site>`
one job (hosted CI runs the four in parallel), `--fast` the pre-push subset (typecheck and unit tests of the changed workspaces),
`--plan` the job selection as `job=true|false` lines. `prepare.mjs` points `core.hooksPath` at `.githooks` on install.
