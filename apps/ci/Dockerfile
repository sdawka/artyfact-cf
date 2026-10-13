# The Sandbox image must match the @cloudflare/sandbox version @cloudflare/ci 0.2.0 runs (0.12.1).
FROM docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5

# The bundle and deploy steps run this Wrangler, never one from the app repo: it lives outside /workspace, is called
# by absolute path through /opt/artyfact/bin/wrangler (absolute node, no PATH lookup), and every runner starts from
# this image, so nothing an earlier step changed under /opt survives. Bump WRANGLER_VERSION deliberately and update
# apps/ci/README.md and docs/ci.md with it.
# The image ships npm 10.9.8, whose resolver crashes ("Cannot read properties of null (reading 'edgesOut')") on app
# package.json files that pin vitest 5.0.3 (needed while vitest 5.0.4 breaks @cloudflare/vitest-plugin). npm 12 installs
# them. Bump deliberately, like WRANGLER_VERSION.
ARG NPM_VERSION=12.2.0
RUN npm install --global "npm@${NPM_VERSION}" && npm --version

ARG WRANGLER_VERSION=4.149.0
RUN npm install --global --prefix /opt/wrangler "wrangler@${WRANGLER_VERSION}" \
 && mkdir -p /opt/artyfact/bin \
 && printf '#!/bin/sh\nexec %s /opt/wrangler/lib/node_modules/wrangler/bin/wrangler.js "$@"\n' "$(readlink -f "$(command -v node)")" > /opt/artyfact/bin/wrangler \
 && chmod 755 /opt/artyfact/bin/wrangler \
 && /opt/artyfact/bin/wrangler --version
