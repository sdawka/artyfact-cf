# Artyfact public site

Static, pre-rendered pages at /, /model, /how-it-works and /connect-agent, with one React example island. Apache-2.0. The /how-it-works diagram is generated at build time from the repository's own `genome/` (journey `J.lifecycle`).
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
Token CSS is a site-owned snapshot of the platform's Whimsy theme. Georgia is the display fallback.

The homepage pairs familiar practices with what Artyfact does with them, tagged built in, extended or connected (src/practiceStackData.ts; each claim checked against the platform, partial work marked). Its centerpiece is an illustrative checkout change in seven steps. Step buttons and, on wide screens, native scrolling drive one step state; a chosen step holds until the reader scrolls to another. Without JavaScript all seven steps render stacked. Reduced motion removes transitions; nothing autoplays.

Effects: the ambient field comes from the private workspace package `@artyfact/effects`, loading after hydration and an idle moment. It mounts into an empty, aria-hidden slot and falls back to CSS haze without a usable GPU. The example uses ordinary HTML, not the former hero Orb. Shared GPU engines are unchanged.

Public build settings (all optional, read at build time):

- SITE_SOURCE_URL: public source repository URL, default https://github.com/sdawka/artyfact-cf. Set it empty to show publication pending.
- SITE_PLATFORM_URL: platform entry, default https://artyfact-platform.dawka.workers.dev. `/app` is also accepted.
- SITE_PLATFORM_READY=false: hides platform links. True by default.

The public site is deployed independently as artyfact-site. Its CSP permits scripts, styles and images
from this site only. Browser tests fulfill requests from the built output, including the production CSP;
they need Chromium but no local server or Cloudflare login.

Deployment: run the deploy workspace script with Wrangler authentication for the account owning artyfact.ing;
see [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/) for the token roles.
