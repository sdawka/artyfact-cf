# peopling app

Small Hono Worker (Static Assets + D1) that agents fork to realize evolutions of the peopling System.

    pnpm install     # from the repo root
    pnpm run dev     # wrangler dev; GET /health, /api/contacts
    pnpm test        # workerd via @cloudflare/vitest-plugin

Create the D1 database once (`database_name` peopling), put its id in `wrangler.jsonc`, then apply
`migrations/0001_contacts.sql`. The Genome's nodes map these paths to model nodes through their `files` globs.

## Auth

`/api/contacts` requires an identity (`src/worker/auth.ts`); otherwise 401. Deployed, set `ACCESS_AUD` and
`ACCESS_TEAM_DOMAIN` and put the Worker behind Cloudflare Access: the `Cf-Access-Jwt-Assertion` JWT is verified and
its `sub` becomes the owner. For local runs copy `.dev.vars.example` to `.dev.vars` (gitignored), which sets `DEV_AUTH_HEADER=1` so requests can send
an `x-owner` header. It is not in `wrangler.jsonc`, so it never ships. This implements the Genome's provisional `policy.authentication`.
