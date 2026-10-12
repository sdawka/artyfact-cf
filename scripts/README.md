# scripts

`bootstrap.sh [flags]` is a wrapper over `npx artyfact init --genome examples/keep-in-touch-system --app examples/keep-in-touch-app`.
Flags pass through (`--adopt`, `--force`, `--platform <url>`, `--namespace <ns>`). `init` derives `keep-in-touch.genome` and
`keep-in-touch.app` from the System id, creates the namespace and the `platform` repo when missing, pushes with short-lived
tokens, and imports with `ARTYFACT_ADMIN_TOKEN`. Details: `packages/cli/README.md`. The demo, end to end, is in `docs/demo-runbook.md`.
