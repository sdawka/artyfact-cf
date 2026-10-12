# Contributing

Work from the repository root.

```sh
npm install
npm test
npm run typecheck
npm run e2e
```

- Keep changes small and add a test with each behaviour change.
- Verdicts are never green without evidence. A change that makes `unknown` look like `pass` will not be accepted.
- Do not hand-edit `apps/platform/worker/env.d.ts`. Run `npm run cf-typegen -w @artyfact/platform`.
- Never commit `.dev.vars` or tokens.
- Commit messages are short and say what changed.

Design notes are in `docs/design`. Licence: Apache-2.0.
