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
Token CSS is a site-owned snapshot of the platform's Whimsy theme. Georgia is the display fallback.

Effects: the home hero orb and the page's ambient field come from the private workspace package `@artyfact/effects`.
src/client.tsx imports src/effects.tsx after hydration, the load event and an idle callback; it mounts both with
createRoot into empty, aria-hidden slots, so they never take part in hydration. The orb follows the explorer's layer
and subject (src/orbState.ts). Without WebGL2 or JS, CSS haze stands in. src/styles/effects.css mirrors the platform's
effect tokens. The orb code is MIT + Commons Clause (see packages/effects); do not copy it into this app.

Public build settings (all optional, read at build time):

- SITE_SOURCE_URL: public source repository URL, default https://github.com/sdawka/artyfact-cf. Set it empty to show publication pending.
- SITE_PLATFORM_URL: platform entry, default https://artyfact-platform.dawka.workers.dev. `/app` is also accepted.
- SITE_PLATFORM_READY=false: hides platform links. True by default.

The public site is deployed independently as artyfact-site. Its CSP permits scripts, styles and images
from this site only. Browser tests fulfill requests from the built output, including the production CSP;
they need Chromium but no local server or Cloudflare login.

Deployment: run the deploy workspace script with Wrangler authentication for the account owning artyfact.ing;
see [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/) for the token roles.
