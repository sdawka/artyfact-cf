# keep-in-touch app

Small Hono Worker (Static Assets + D1) that agents fork to realize evolutions of the keep-in-touch System.

    npm install
    npm run dev      # wrangler dev; GET /health, /api/contacts
    npm test         # workerd via @cloudflare/vitest-plugin

Create the D1 database once (`database_name` keep-in-touch), put its id in `wrangler.jsonc`, then apply
`migrations/0001_contacts.sql`. `source-map.yaml` maps paths to model nodes for the platform.
