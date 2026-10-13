---
name: artyfact-genome
description: Write or update this repository's Genome (an artyfact node tree with files bindings), validate it locally, then import it with artyfact init.
---

# Write this repository's Genome

A Genome is a tree of `node.yaml` files that describes a System: what it is for, which Things it is made of, and which source files realise each node. You are writing it for code that already exists, so describe what the repository does today. Do not invent features, checks or paths. The person reviews and accepts every node on the platform before anything counts.

## When to use

- The repository has no Genome yet and the person wants it on artyfact.
- Code changed and the Genome (`./genome`) no longer matches it.
- `npx artyfact validate-genome` reports errors, unmapped files or stale globs.

Do not use it to plan new features. That is an Evolution, and you never edit `evolutions/`.

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
npx artyfact init --genome ./genome --app .
```

A new import waits in review. Tell the person to open Review on the platform, choose the Import row, agree or reject each node (a rejected node is removed through an amendment they then accept), write their interpretation and accept. Nothing is evolved, planned or started until they do.

## 6. Realize (after the person plans an Evolution)

Once an Evolution is planned into Tasks, the platform groups them into waves: the tasks of one wave share no files, so they can run in parallel, and a task of a later wave waits for the earlier ones to be promoted. Claim your task and work in an isolated directory:

```
npx artyfact tasks --system <id>
ARTYFACT_ADMIN_TOKEN=… npx artyfact claim <task-id> --system <id> --agent <label> --dir ./work/<task-id>
```

`claim` needs `ARTYFACT_ADMIN_TOKEN` in the environment of whoever runs it; if you do not have it, ask the person to claim the task and work in the directory they give you. If `claim` says `blocked by …` or `claimed by …`, stop and tell the person; do not work around it. Read `AGENTS.md` and `TASK_PACKET.md` in the work directory. Edit only inside the permitted paths, and leave the paths other tasks own alone. Save progress with `npx artyfact checkpoint "<what, why, what is left>"`, then hand in with `npx artyfact submit`. The platform verifies; your logs are advisory.

`claim` saves this task's fork token in `.artyfact.json` (owner-only, git-excluded) so `submit` works without it in the environment. Never print, commit or copy that file or the token.

## Checklist before stopping

- `validate-genome` ends in `ok:` with no errors, and no unmapped or stale entries remain.
- Every node has a `name` and a one-sentence `description`; every link uses a relation the template declares.
- Every criterion and hook command exists and runs today; no secrets or invented paths appear.
- You did not edit `evolutions/` or any file outside `./genome` and `.artyfactignore`.
- Tell the person the exact `init` command and that Review, then Import is theirs to accept.
