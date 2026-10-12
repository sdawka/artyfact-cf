# Artyfact public site

Static, pre-rendered pages at /, /model, and /connect-agent, with one React example island. Apache-2.0.
The guide works without JavaScript; the model example has a readable initial state.

From the repository root:

    npm ci
    npm run build -w @artyfact/site
    npm run preview -w @artyfact/site    # http://127.0.0.1:4180
    npm run typecheck -w @artyfact/site
    npm run test -w @artyfact/site
    npm run test:build -w @artyfact/site
    npm run e2e -w @artyfact/site

The build uses Vite/React to render HTML and hydrate the example.
src/render.tsx renders the pages; src/client.tsx handles copy controls and lazily loads the example.
Token CSS is a site-owned snapshot of the platform's Whimsy theme. Brilon is not distributed; Georgia is the fallback.

Public build settings:

- SITE_SOURCE_URL: verified public source repository URL. Empty by default; the site shows publication pending.
- SITE_PLATFORM_URL: verified platform entry, default /app.
- SITE_PLATFORM_READY=true: enables platform navigation. False by default.

The platform owner mounts /app, including assets, API paths, authentication and redirects, before the
availability flag is enabled. The public site is deployed independently as artyfact-site.
Its CSP permits scripts, styles and images from this site only. Browser tests fulfill requests from the
built output, including the production CSP; they need Chromium but no local server or Cloudflare login.

Deployment: set CLOUDFLARE_ACCOUNT_ID to the account owning artyfact.ing, verify the existing domain,
and run the deploy workspace script with Wrangler authentication. Use a site-only token: Workers product
Admin for initial creation, plus Zone Read and Workers Routes Write on artyfact.ing for domain setup.
Use Workers product Editor for later custom-domain deployments; Cloudflare does not yet support
per-Worker roles on custom domains. See [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/).
No runtime secrets or data bindings are needed.

Site CI builds, checks types, verifies generated links/metadata, and runs desktop/mobile browser checks.
Publish only after all repository CI checks are green. Keep platform fixes with their owner.
