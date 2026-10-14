---
name: artyfact-genome
description: Write or update this repository's Genome (an artyfact node tree with files bindings), validate it locally, then import it with artyfact init.
---

# Write this repository's Genome

A Genome is a tree of `node.yaml` files that describes a System: what it is for, which Things it is made of, and which source files realise each node when source exists. Choose the new-intent or existing-code path below. Do not invent agreement, implemented behavior, checks or paths. The person reviews the exact snapshot before anything counts.

## Author a new System from intent

For an idea without code, first preserve the person's words in `intent/brief.md`: purposes, actors, boundaries, concepts, relationships, constraints, observable acceptance criteria, exclusions, assumptions, disagreements and unresolved questions. Ask only consequential clarification questions; distinguish proposed behavior from implemented behavior. Cite canonical sources rather than silently filling gaps.

Create `intent/manifest.json` with `{"version":1,"nodes":[{"nodeId":"...","briefSections":["Exact ATX heading text"],"documents":[{"path":"docs/example.md","hash":"sha256:..."}]}]}`. Heading text is exact and case-sensitive. Paths are safe repository-relative references and hashes cover exact document bytes. Never include secrets, credentials or absolute local paths.

Write native nodes using the templates below. Before the first CLI check, create the System at `<origin>/start` and accept any custom native package there; a planned Genome using built-in packages needs no app. Run local structural validation without an app argument for a source-free Genome, then `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact ontology check --system <system> --genome ./genome --platform <origin> --json`. Return its durable Review URL and disclose assumptions, citations, unresolved questions and incomplete semantic coverage. Record reviewed dispositions with `ontology agreement`; materialize only an eligible agreed envelope. Run the local authoring agent with `env -u ARTYFACT_ADMIN_TOKEN` so it never inherits the admin credential.

## Author from existing code

## When to use

- The repository has no Genome yet and the person wants it on artyfact.
- Code changed and the Genome (`./genome`) no longer matches it.
- `npx artyfact validate-genome` reports errors, unmapped files or stale globs.

Do not present planned features as existing code. Existing-System changes use the same brief, manifest and integrity review; implementation still belongs to Tasks. Never edit `evolutions/` directly.

## 1. Choose templates

Pick one System template and one Thing template per deployable unit. Full kinds, parents and required fields are in `reference/templates.md`.

System templates:
- `template.system.dev-platform.cloudflare@1`: software made of Things. Use it unless the product is a social network.
- `template.system.social-networking.cloudflare@1`: a social product with private relationships. Domain-specific, rarely right.

Thing templates:
- `template.thing.cli@1`: a command-line tool. Kinds `command`, `option`, `module`.
- `template.thing.cloudflare-worker-service@1`: a Worker serving an API. Kinds `endpoint`, `durable-object`, `workflow`, `queue`, `module`.
- `template.thing.cloudflare-worker-webapp@1`: a full-stack Worker app with UI, D1 and a scheduler. Kinds `screen`, `component`, `affordance`, `operation`, `entity`, `policy`, `binding`.
- `template.thing.vue-webapp@1`: the same contract with a Vue single-page UI.
- `template.thing.static-site@1`: a prebuilt site. Kinds `page`, `asset`.
- `template.thing.ts-library@1`: a package other code imports. Kinds `export`, `module`.

If nothing fits, use the closest one and keep the extra code under `module` or `section` nodes. Never invent a kind.

## 2. Walk the codebase

1. Run `git ls-files`. Read the root `package.json` workspaces, each `wrangler.jsonc` `name`, and each `bin` entry. Every workspace, Worker or published package is a candidate Thing. A single-app repo has one Thing rooted at the repository.
2. Group source by directory. Each cohesive directory or file under `src/` becomes a `module` node with one stated responsibility.
3. Find the public surface: router registrations (`app.get(...)`, route tables) become `endpoint` nodes with the exact route string; the CLI dispatch switch gives one `command` per `case`; page files or route components give `screen` or `page` nodes; package exports give `export` nodes.
4. Read the README, tests and scripts for purposes, commitments and verification commands. Prefer what the tests prove over what the prose claims.

## 3. Write the tree

Write the tree under `./genome`.

- **One `node.yaml` per directory.** The directory name is a slug and `id` is the identity. The parent is the node of the enclosing directory, and a `node.yaml` whose parent directory has none is an error. Name a directory after its id (`thing.cli/section.modules/module.cli.naming/node.yaml`).
- **Root shape.** `genome/node.yaml` holds `id: system.<slug>`, `kind: system`, `template: <system template>`, and `fields: {name, description}`. Add the template's sections as directories (`section.purpose/`, `section.theory/`, `section.description/` with their `node.yaml`).
- **Thing shape.** `genome/thing.<name>/node.yaml` holds `kind: thing`, `template: <thing template>`, `fields: {name, description}`, and `root:` set to the repo-relative workspace path (`apps/api`). Leave `root` out when the Thing is the whole repository; `.` is rejected. Link its artifact: `links: [{rel: artifact, to: artifact.<name>}]` plus a child `artifact.<name>/node.yaml` with `kind: artifact`, `fields: {type: external, repo: <repo name>, scope: [<root>]}`.
- **Sections.** Create the sections the Thing template requires (see the digest). Each has `fields: {name, description}` and its modules, commands or endpoints beneath it.
- **Fields.** Every node has `fields.name` and a one-sentence `fields.description` that says what it does, not what it is called. Fill the kind's required fields (a command needs `usage`, an endpoint needs `route` and `auth`).
- **Links.** Use only relations the template declares (`implements`, `exposes`, `dependsOn`, `invokes`, ...) between kinds it allows. Link a module to the command or endpoint it implements.
- **Files.** `files` globs are relative to the Thing root. Kind defaults already cover `src/{slug}.ts` and `src/{slug}/**` for a module, and the template maps its config files and `test/**`. Add `files` for anything else. Every tracked file under the root must match some node.
- **Criteria.** Add `C.<thing>.<x>` only for checks that exist. A hook's `inputs.command` must be a command that runs today (`npm test -w packages/api`). Each Thing needs the soft `C.<thing id>.checks` criterion its template requires:

```yaml
criteria:
  - id: C.thing.api.checks
    title: Changed nodes meet their checks
    claim: Changed nodes meet the checks their kinds declare.
    severity: soft
    gates: [submission]
    hooks:
      - id: hook.thing.api.checks
        assay: api.checks
        tier: semantic
        engine: model-rules
        triggers: [submission]
        inputs: {packs: checks@1}
        binding: bound
        fromTemplate: template.thing.cloudflare-worker-service@1
    fromTemplate: template.thing.cloudflare-worker-service@1
```

- **Never** write secrets, tokens or values from `.env`/`.dev.vars`. Never name a path or command that does not exist. Never touch `evolutions/`.

A minimal module node:

```yaml
id: module.api.billing
kind: module
fields: {name: Billing, description: Creates invoices and records payments.}
links: [{rel: implements, to: endpoint.create-invoice}]
files: [src/billing/**, src/stripe.ts]
```

## 4. Validate until clean

```
npx artyfact validate-genome ./genome --app .
```

- Fix every `error`. `ref.dangling` usually names a section or criterion the template requires. A codec error names the file.
- Map every `unmapped` path: widen a `files` glob, add a node, or list the path in `.artyfactignore` at the app root (gitignore-style lines, for build output, fixtures and generated code).
- Delete every `stale` glob: it names no tracked file, so the node points at code that does not exist.
- Read the warnings. `node.provisional` and `hook.unbound` are acceptable when true; the rest usually are not.
- Use `--json` for tooling and `--strict` to fail on unmapped or stale paths too. Stop only when the output ends in `ok:`.

## 5. Import

```
npx artyfact init --genome ./genome --app . --integrity-run <eligible-run>
```

Then tell the person to open Review, then Import on the platform and agree node by node. Nothing is evolved until they accept.

## 6. Realize (after the person plans an Evolution)

An Evolution changes only the Genome. Implementation runs through a Realization plan of Tasks. Draft one, then claim Tasks wave by wave:

```
npx artyfact plan draft --system <id> --evolution <evolution-id> [--node <node-id>] [--hint "<text>"]   # saves nothing
npx artyfact plan draft --system <id> --evolution <evolution-id> --create                                 # saves it and prints the plan id
npx artyfact plan tasks <plan> --system <id>                  # status, wave, depends-on, write nodes, footprint, conflicts, next claim
```

Claim a Task with the admin token on that one command, from `ADMIN_TOKEN`, a shell variable set without exporting it; then run the agent without it, then submit:

```
ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim <plan> <task> --system <id> --dir ./work/<task> --agent-label claude:<task>
cd ./work/<task> && env -u ARTYFACT_ADMIN_TOKEN claude -p "Follow AGENTS.md and TASK_PACKET.md, then run npx artyfact task submit"
```

`task claim` stores the fork write token in `.git/artyfact-task.json` (mode 0600, never staged, never printed) and `task submit` finds it there; never export the admin token or set it in a shell profile, and never paste either token into source, logs or a review. Read `AGENTS.md` and `TASK_PACKET.md`, edit only inside the permitted paths, save progress with `npx artyfact task checkpoint "<what, why, what is left>"`, then hand in with `npx artyfact task submit`. The platform verifies; your logs are advisory. Claim only Tasks `plan tasks` names as claimable; a `blocked by`, `taken by` or `conflicts with` message means wait or pick another. Resume an interrupted attempt with `task resume`, which refreshes the stored token. Run `npx artyfact` to see which commands your installed release has.

## Checklist before stopping

- `validate-genome` ends in `ok:` with no errors, and no unmapped or stale entries remain.
- Every node has a `name` and a one-sentence `description`; every link uses a relation the template declares.
- Every criterion and hook command exists and runs today; no secrets or invented paths appear.
- You did not edit `evolutions/` or any file outside `./genome` and `.artyfactignore`.
- Tell the person the exact `init` command and that Review, then Import is theirs to accept.

## Prepare an accepted import locally

This is a separate workflow from authoring a Genome for existing source above. An accepted custom ontology may have no source yet. A Genome-only System with no Thing or source is valid completion; do not invent implementation to make it pass.

1. Set `ADMIN_TOKEN` in the shell without exporting it. Pass `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN"` on each administrative command and `--platform <origin>` explicitly. Browser credentials do not configure the shell.
2. Materialize exact accepted files: `npx artyfact ontology materialize --file reviewed-snapshot.json --dir ./project --prepare-only`. This creates a new directory without provisioning. Then run `npx artyfact skill --dir ./project --write --agent generic` and work in that project. To recover, continue in the existing directory; materialize never overwrites it.
3. For implementation, prepare only minimal genuine scaffold/app source in `./app`, plus accurate Thing/artifact/source mappings to files that exist. Use the accepted custom template vocabulary, or a matching supported Thing scaffold. Do not implement requested features here: feature work belongs to Tasks. If keeping the System Genome-only, skip source and planning.
4. Run `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact init --dir . --integrity-run <eligible-run> --platform <origin>` with default import review. If no local app exists for a declared binding, finish the scaffold or use a matching `--from-template <thing-template@version>`; never claim nonexistent source. Changed Genome content must return to Review for acceptance. Custom packages require server import validation because the local validator cannot resolve accepted custom packages; bundled templates can also use local validation.
5. After the person accepts the import, choose actual source-bound node IDs from the accepted Genome. Draft with `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan draft --system <system> --node <source-bound-node-id> --platform <origin>`. Review scope and problems, then repeat the same node arguments with `--create`. No plan file is assumed. Return the durable plan review URL before implementation.

## Coordinate accepted Genome implementation

An Evolution changes only the Genome. Never use it to deploy code or change live flags.
A Realization implements a pinned accepted Genome; Tasks own artifact bindings and isolated forks.
Artyfact stores plans and evidence. Run agents in the user's local harness.

- Propose a Genome change with `npx artyfact evolution propose --system <system> --file intent.json`
  (`intent.json` contains `message` and optionally `anchor`). Return its review URL.
- Draft accepted source-bound nodes with `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan draft --system <system> --node <source-bound-node-id> --platform <origin>`; optionally include `--evolution <evolution>`. Review the table, waves and problems, then repeat with `--create` to save it. `plan tasks <plan> --system <system> --platform <origin>` shows the next action.
- Claim only eligible Tasks, with the admin token on that command only (`ADMIN_TOKEN` set in the shell, not exported):
  `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task claim <plan> <task> --system <system> --dir ./task --agent-label claude:<task>`.
  Run the agent with `env -u ARTYFACT_ADMIN_TOKEN claude -p "..."`. The fork write token is saved in `.git/artyfact-task.json`
  (mode 0600, never staged) and never printed; `task submit` reads it, so `ARTYFACT_TOKEN` is optional. Never paste credentials
  into source, logs, a review, or another agent's context.
- Read TASK_PACKET.md. Honor the pinned Genome, permitted paths, read/write scope and checks.
  Inside the fork use `npx artyfact task checkpoint "<what changed and what remains>"` and `task submit`.
- Resume interruptions with `task resume <plan> <task> --system <system> --dir ./task`.
  This preserves the fork and stores fresh credentials, fencing the old attempt. Never start a second writer.
- Review each candidate, then `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task select <plan> <task> --system <system> --candidate <candidate>`.
  Integrate with `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan integrate <plan> --system <system>` and read `plan review <plan> --system <system>`.
- Return the combined implementation review URL. Promotion requires that exact reviewed candidate set
  and expected System head; use `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact plan promote <plan> --system <system> --file reviewed-promotion.json`.
- Metrics and Flagship controls are separate: `operations metrics|flags|audit --system <system> --binding <binding>`.
  Never infer intended outcomes from raw request counts. Flag changes require an explicit reason and version.

Administrative commands use `ARTYFACT_ADMIN_TOKEN`, passed per command as `ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN"`; attempt commands use their scoped saved secret and stored write token. Plan reads (`plan tasks`, `plan show`) need no token for a public System.
