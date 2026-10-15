# Contributing

Work from the repository root.

```sh
pnpm install
pnpm test
pnpm run typecheck
pnpm run e2e
```

- `pnpm install` points git at `.githooks`, so `git push` first runs `pnpm run ci --changed`: the same script GitHub CI runs (`scripts/ci.mjs`, the single definition of CI), headless with software WebGL (`ARTYFACT_E2E_NO_GPU=1`), limited to the jobs your commits touch. Run `pnpm run ci` for the full set. Skip once with git's `--no-verify`.
- Keep changes small and add a test with each behaviour change.
- Verdicts are never green without evidence. A change that makes `unknown` look like `pass` will not be accepted.
- Do not hand-edit `apps/platform/worker/env.d.ts`. Run `pnpm --filter @artyfact/platform cf-typegen`.
- Never commit `.dev.vars` or tokens.
- Commit messages are short and say what changed.

Design notes are in `docs/design`. Licence: Apache-2.0.
