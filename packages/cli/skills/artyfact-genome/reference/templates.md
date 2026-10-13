# Template digest

Digest of `packages/templates/{system,thing}/*/template.yaml` as the loader composes them. Templates are pinned by ref in a node's `template:` field. Kinds the base template (`template.meta.artyfact-genome@1`) gives every template: `system`, `thing`, `section`, `screen`, `component`, `affordance`, `route`, `entity`, `field`, `operation`, `policy`, `binding`, `grouping`, `external`, `purpose`, `claim`, `requirement`, `template`, `kit`, `artifact`, `feature`, `commitment`, `criterion`, `hook`, `journey`, `step`, `evolution`. A template's own kinds are listed below.

Base kinds with a parent limit: `external`, `purpose`, `claim`, `feature`, `commitment` sit under the `system`; `journey` under the `system` or a `thing`; `step` under a `journey`. The others have no limit. Every node takes `fields.name` and `fields.description`.

Base relations usable in `links` with any kind on both ends: `contains`, `serves`, `invokes`, `governs`, `reads`, `writes`, `storedIn`, `refines`, `realizes`, `dependsOn`, `satisfies`, `measures`, `affects`, `inherits`, `triggers`, `references`. Restricted: `artifact` (thing to artifact), `pinned` (written for you from `template:`), `requires`, `owner`, `subject`, `stepNext`, `stepScreen`, `stepOperation`, `stepExternal`, `beneficiary` (purpose or claim to external).

Every Thing template makes the Thing require the criterion `C.<thing id>.checks` (soft, gate `submission`, one `model-rules` hook with `inputs: {packs: checks@1}`, both marked `fromTemplate`). Copy its shape from any Thing in the repo's Genome or from `artyfact validate-genome` errors (`ref.dangling`).

## System templates

### template.system.dev-platform.cloudflare@1
For software systems made of Things on Cloudflare. Fits almost any repository.
- Prefilled sections under the root: `<system id>.purpose`, `<system id>.theory`, `<system id>.description` (write them as `section.purpose/`, `section.theory/`, `section.description/` directories).
- Extra relations: `calls` and `deploys` (thing to thing).
- Rule pack `topology.services@1` (opt in with `fields.rulePacks: [{id: topology.services, version: "1"}]` on the root): an `endpoint` must sit under a Worker service Thing, Things must not form a `dependsOn` cycle, a ts-library Thing nobody depends on is a warning.
- Root check: the description says what each Thing is for.

### template.system.social-networking.cloudflare@1
For a social-networking product with private relationships. Fits only that domain.
- Prefilled sections: `section.purpose`, `section.externals`, `section.theory`, `section.description`.
- Requires Things from `template.thing.*`; adds readiness, privacy and journey rule packs and kits (see `examples/peopling-system`).

## Thing templates

### template.thing.cli@1
A command-line tool.
- Kinds: `command` (parents `section`, `command`; required `name`, `description`, `usage`; optional `exitCodes`), `option` (parent `command`; required `name`, `description`, `flag`; optional `valueType`, `default`), `module` (parents `section`, `module`; required `name`, `description`; optional `path`).
- Module default `files`: `src/{slug}/**`, `src/{slug}.ts`, `worker/{slug}/**`, `worker/{slug}.ts`.
- Thing `files`: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `README.md`, `test/**`.
- Required sections: `<thing id>.commands` (files `bin/**`), `<thing id>.modules` (files `src/**`).
- Relations: `exposes` (thing to command), `implements` (module to command or option), `calls`, `dependsOn`, `stepOperation` (step to operation or command).

### template.thing.cloudflare-worker-service@1
A Cloudflare Worker that serves an API.
- Kinds: `endpoint` (parent `section`; required `name`, `description`, `route`, `auth`), `durable-object`, `workflow`, `queue` (parent `section`; required `name`, `description`), `module` (as in cli).
- Thing `files`: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `wrangler.json`, `wrangler.toml`, `.gitignore`, `README.md`, `test/**`.
- Required sections: `<thing id>.api`, `<thing id>.runtime`, `<thing id>.state` (files `migrations/**`), `<thing id>.modules` (files `src/**`, `worker/**`).
- Relations: `exposes` (thing to endpoint), `implements` (module to endpoint, durable-object, workflow, queue), `invokes` (affordance to endpoint), `calls`, `stepOperation` (step to operation, endpoint or workflow).

### template.thing.cloudflare-worker-webapp@1
A full-stack web app served by one Worker, with static assets, D1 storage and a scheduler. Uses the base kinds (`screen`, `component`, `affordance`, `route`, `entity`, `field`, `operation`, `policy`, `binding`) with no required fields beyond name and description.
- Thing `files`: `src/worker/health.ts`, `src/index.ts`, `src/worker/env.ts`, `src/worker/phenome.ts`, the config files (`package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `wrangler.test.jsonc`, `.gitignore`, `.dev.vars.example`, `README.md`), `test/**`, `public/*`, `.artyfact/**`.
- Prefilled (copy as needed): sections `section.ui` (files `src/ui/**`), `section.domain` (files `src/worker/routes/**`), `section.authorization`, `section.runtime`; bindings `binding.worker`, `binding.d1` (files `migrations/**`), `binding.scheduler`; components `component.AppShell`, `TopBar`, `PrimaryNav`, `RouteOutlet`, `StatePanel`, `ErrorSummary`; `policy.authentication`; criteria `C.webapp.exists`, `C.webapp.health` with hooks.
- Required: only `C.<thing id>.checks`.
- Rule pack `artyfact.authorization@1`: every state-changing `operation` must be governed by a `policy`.

### template.thing.vue-webapp@1
Same section contract and rules as the Worker web app, with a Vue single-page UI.
- Prefilled: the same four sections and bindings `binding.worker`, `binding.d1`; components `component.App`, `component.Router`; criteria `C.webapp.exists`, `C.webapp.health`.
- Declares no `files` of its own, so add `files` to the Thing and its sections (`src/**`, config files, `test/**`).
- Required: only `C.<thing id>.checks`.

### template.thing.static-site@1
A site built ahead of time and served as files.
- Kinds: `page` (parent `section`; required `name`, `description`, `route`), `asset` (parents `section`, `page`; required `name`, `description`, `path`).
- Thing `files`: config files (`package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.*`, `astro.config.*`, `wrangler.jsonc`, `.gitignore`, `README.md`), `src/**`, `test/**`.
- Required sections: `<thing id>.pages` (files `src/pages/**`), `<thing id>.build` (files `public/**`, `scripts/**`).
- Relations: `exposes` (thing to page), `calls` (thing or page to thing or page), `stepScreen` (step to screen or page). It has no `module` kind.

### template.thing.ts-library@1
A TypeScript package other Things import.
- Kinds: `export` (parents `section`, `module`; required `name`, `description`, `signature`), `module` (as in cli).
- Thing `files`: `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`, `README.md`, `test/**`.
- Required sections: `<thing id>.api`, `<thing id>.modules` (files `src/**`).
- Relations: `exposes` (thing to export), `implements` (module to export), `dependsOn` (thing or module), `calls`.
