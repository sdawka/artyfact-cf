# keep-in-touch app

Small Hono Worker (Static Assets + D1) that agents fork to realize evolutions of the keep-in-touch System.

    npm install
    npm run dev      # wrangler dev; GET /health, /api/contacts
    npm test         # workerd via @cloudflare/vitest-plugin

Create the D1 database once (`database_name` keep-in-touch), put its id in `wrangler.jsonc`, then apply
`migrations/0001_contacts.sql`. `source-map.yaml` maps paths to model nodes for the platform.

## Auth

`/api/contacts` requires an identity (`src/worker/auth.ts`); otherwise 401. Deployed, set `ACCESS_AUD` and
`ACCESS_TEAM_DOMAIN` and put the Worker behind Cloudflare Access: the `Cf-Access-Jwt-Assertion` JWT is verified and
its `sub` becomes the owner. The scaffold ships with `DEV_AUTH_HEADER=1` in `wrangler.jsonc` so local runs can send
an `x-owner` header; remove it before deploying. This implements the Genome's provisional `policy.authentication`.
