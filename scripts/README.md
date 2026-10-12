# scripts

`bootstrap.sh [--dry-run]` creates (or reuses) the Artifacts namespace `artyfact` and repos `kit-system` and
`kit-app`, then pushes `examples/keep-in-touch-system` and `examples/keep-in-touch-app` to `main`.
A repo that already has `main` is left alone. Requires `wrangler` logged in; `ACCOUNT_ID` is read from the
environment or `wrangler whoami`. Tokens are never printed. `--dry-run` only prints the commands.
