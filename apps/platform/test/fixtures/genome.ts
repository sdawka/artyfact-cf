/**
 * A small Keep-in-Touch-shaped Genome (a v2 node tree) on the real cloudflare-worker-webapp@1 template, plus an app
 * tree. Converted from its v1 layout with `artyfact convert-genome`; the template's prefilled nodes are materialised.
 */
export const genomeFiles: Record<string, string> = {
  "GD.people/node.yaml": `
id: GD.people
kind: feature
fields:
  name: People
  summary: Keep a list of people
  deferred: false
`,
  "P1/node.yaml": `
id: P1
kind: purpose
fields:
  statement: Help people keep in touch with the few people who matter.
  intendedChange: People stay in touch without a feed.
  successCriteria:
    - Owner contacts someone weekly
  nonGoals:
    - engagement
links:
  - { rel: beneficiary, to: ext.person }
`,
  "commitment.private/node.yaml": `
id: commitment.private
kind: commitment
fields:
  statement: Contacts are private to their owner
  features:
    - GD.people
`,
  "evolutions/evolution.1.yaml": `

id: evolution.1
title: List people
intent: Show the owner's contacts on the People screen
state: actionable
kind: implementation
affectedNodes: [screen.people]
acceptanceCriteria: [C.people.list, C.people.sorted, C.people.later]
`,
  "evolutions/evolution.2.yaml": `

id: evolution.2
title: Recipients field
intent: Amend the Genome
state: proposed
kind: genome-amendment
affectedNodes: [entity.ContactRecord]
acceptanceCriteria: []
`,
  "ext.person/node.yaml": `
id: ext.person
kind: external
fields:
  name: Person
  kind: person
  modeled: Account and contacts
  external: Their relationships
`,
  "node.yaml": `
id: system.kit
kind: system
fields:
  name: Keep in Touch (test)
  phase: unrealized
  rulePacks:
    - id: metamodel
      version: "1"
  narrative: A private contact list.
criteria:
  - id: C.system.promotion
    title: Changes stay in scope
    claim: A candidate only touches what its packet permits
    gates:
      - submission
      - promotion
    hooks:
      - id: hook.system.scope
        assay: diff scope
        tier: basic
        engine: model-rules
        target: artifact
        triggers:
          - submission
          - promotion
        inputs:
          check: base-current,scope-authorized,manifest-exact,evidence-fresh
        binding: bound
`,
  "thing.webapp/J.add/e1/node.yaml": `
id: J.add/e1
kind: step
fields:
  step: e1
  actor: system
  action: Done
  kind: end
  unresolved: false
`,
  "thing.webapp/J.add/node.yaml": `
id: J.add
kind: journey
fields:
  name: Add a contact
  actorGoal: Owner records someone
  features:
    - GD.people
  start: s1
  deferred: false
`,
  "thing.webapp/J.add/s1/node.yaml": `
id: J.add/s1
kind: step
fields:
  step: s1
  actor: user
  action: Open people
  kind: action
  unresolved: false
  next:
    - to: s2
links:
  - { rel: stepScreen, to: screen.people }
`,
  "thing.webapp/J.add/s2/node.yaml": `
id: J.add/s2
kind: step
fields:
  step: s2
  actor: user
  action: Save contact
  kind: action
  unresolved: false
  next:
    - to: e1
links:
  - { rel: stepOperation, to: operation.contact.save }
`,
  "thing.webapp/node.yaml": `
id: thing.webapp
kind: thing
template: template.thing.cloudflare-worker-webapp@1
fields:
  name: Keep in Touch web app
  description: The app
  purposeRefs:
    - P1
  sections:
    - section.ui
    - section.domain
    - section.authorization
    - section.runtime
  artifacts:
    - artifact: artifact.webapp
      type: worker-fullstack
      repo: kit-app
      scope: []
criteria:
  - id: C.webapp.exists
    title: Web app exists
    claim: The app has the files a deployable Worker needs.
    target: artifact
    gates:
      - candidate
      - promotion
    hooks:
      - id: hook.webapp.exists
        assay: webapp.requiredFiles
        tier: basic
        engine: manifest
        triggers:
          - candidate
          - promotion
        inputs:
          requiredFiles: wrangler.jsonc,src/index.ts,package.json
        binding: bound
        fromTemplate: template.thing.cloudflare-worker-webapp@1
    fromTemplate: template.thing.cloudflare-worker-webapp@1
  - id: C.webapp.health
    title: Web app is healthy
    claim: The running app answers its health endpoint.
    target: runtime
    gates:
      - deployment
      - outcome
    hooks:
      - id: hook.webapp.health
        assay: webapp.health
        tier: execution
        engine: http
        triggers:
          - deployment
          - outcome
        inputs:
          path: /health
        timeoutMs: 2000
        fromTemplate: template.thing.cloudflare-worker-webapp@1
    fromTemplate: template.thing.cloudflare-worker-webapp@1
  - id: C.thing.webapp.checks
    title: Changed nodes meet their checks
    claim: Changed nodes meet the checks their kinds declare.
    severity: soft
    gates:
      - submission
    hooks:
      - id: hook.thing.webapp.checks
        assay: webapp.checks
        tier: semantic
        engine: model-rules
        triggers:
          - submission
        inputs:
          packs: checks@1
        binding: bound
        fromTemplate: template.thing.cloudflare-worker-webapp@1
    fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.authorization/node.yaml": `
id: section.authorization
kind: section
fields:
  name: Authorization
  owningThing: thing.webapp
  revision: 1
  description: Policies governing who may read or change what.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.authorization/policy.authentication/node.yaml": `
id: policy.authentication
kind: policy
fields:
  name: Authentication
  owningThing: thing.webapp
  revision: 1
  description: Who counts as a signed-in user. Provisional until an auth kit is pinned.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
provisional: true
`,
  "thing.webapp/section.authorization/policy.ownerOnly/node.yaml": `
id: policy.ownerOnly
kind: policy
fields:
  name: Owner only
  owningThing: thing.webapp
  revision: 1
  mode: owner-only
links:
  - { rel: governs, to: operation.contact.save }
`,
  "thing.webapp/section.domain/entity.ContactRecord/node.yaml": `
id: entity.ContactRecord
kind: entity
fields:
  name: Contact record
  owningThing: thing.webapp
  revision: 1
`,
  "thing.webapp/section.domain/node.yaml": `
id: section.domain
kind: section
fields:
  name: Domain
  owningThing: thing.webapp
  revision: 1
  description: Entities, operations and invariants.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.domain/operation.contact.save/node.yaml": `
id: operation.contact.save
kind: operation
fields:
  name: Save contact
  owningThing: thing.webapp
  revision: 1
links:
  - { rel: writes, to: entity.ContactRecord }
`,
  "thing.webapp/section.runtime/binding.d1/node.yaml": `
id: binding.d1
kind: binding
fields:
  name: D1 database
  owningThing: thing.webapp
  revision: 1
  description: Placeholder relational store. Instances rename or replace it via override (for example binding.contactsStore).
  fromTemplate: template.thing.cloudflare-worker-webapp@1
provisional: true
`,
  "thing.webapp/section.runtime/binding.scheduler/node.yaml": `
id: binding.scheduler
kind: binding
fields:
  name: Cron scheduler
  owningThing: thing.webapp
  revision: 1
  description: Cron Triggers for periodic work.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.runtime/binding.worker/node.yaml": `
id: binding.worker
kind: binding
fields:
  name: Worker with static assets
  owningThing: thing.webapp
  revision: 1
  description: Cloudflare Worker serving the API and the built UI through Workers Static Assets.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.runtime/node.yaml": `
id: section.runtime
kind: section
fields:
  name: Runtime
  owningThing: thing.webapp
  revision: 1
  description: Bindings and deployment surface.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/component.AppShell/component.PrimaryNav/node.yaml": `
id: component.PrimaryNav
kind: component
fields:
  name: PrimaryNav
  owningThing: thing.webapp
  revision: 1
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/component.AppShell/component.RouteOutlet/node.yaml": `
id: component.RouteOutlet
kind: component
fields:
  name: RouteOutlet
  owningThing: thing.webapp
  revision: 1
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/component.AppShell/component.TopBar/node.yaml": `
id: component.TopBar
kind: component
fields:
  name: TopBar
  owningThing: thing.webapp
  revision: 1
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/component.AppShell/node.yaml": `
id: component.AppShell
kind: component
fields:
  name: AppShell
  owningThing: thing.webapp
  revision: 1
  description: Frame holding the top bar, primary navigation and route outlet.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/component.ErrorSummary/node.yaml": `
id: component.ErrorSummary
kind: component
fields:
  name: ErrorSummary
  owningThing: thing.webapp
  revision: 1
  description: Shared summary of form and request errors.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/component.StatePanel/node.yaml": `
id: component.StatePanel
kind: component
fields:
  name: StatePanel
  owningThing: thing.webapp
  revision: 1
  description: Shared loading, empty and unavailable states.
  states:
    - loading
    - empty
    - unavailable
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/node.yaml": `
id: section.ui
kind: section
fields:
  name: UI
  owningThing: thing.webapp
  revision: 1
  description: Screens, shared components and affordances.
  fromTemplate: template.thing.cloudflare-worker-webapp@1
`,
  "thing.webapp/section.ui/screen.people/component.AddContactDialog/node.yaml": `
id: component.AddContactDialog
kind: component
fields:
  name: Add contact
  owningThing: thing.webapp
  revision: 1
`,
  "thing.webapp/section.ui/screen.people/node.yaml": `
id: screen.people
kind: screen
fields:
  name: People
  owningThing: thing.webapp
  revision: 1
  route: /people
criteria:
  - id: C.people.list
    title: People screen lists contacts
    claim: The People screen shows the owner's contacts
    target: artifact
    gates:
      - submission
    hooks:
      - id: hook.people.list
        assay: people list test
        tier: execution
        engine: vitest
        triggers:
          - submission
        binding: bound
  - id: C.people.sorted
    title: People are sorted by name
    claim: The People screen lists contacts alphabetically
    severity: soft
    target: artifact
    gates:
      - submission
      - promotion
  - id: C.people.audit
    title: People screen passes the promotion audit
    claim: Checked only at promotion
    target: artifact
    gates:
      - promotion
    hooks:
      - id: hook.people.audit
        assay: people audit
        tier: execution
        engine: vitest
        triggers:
          - promotion
        binding: bound
  - id: C.people.lint
    title: People screen lints at submission
    claim: Checked only at submission
    target: artifact
    gates:
      - submission
    hooks:
      - id: hook.people.lint
        assay: people lint
        tier: execution
        engine: vitest
        triggers:
          - submission
        binding: bound
  - id: C.people.later
    title: Deferred nicety
    claim: Later
    target: artifact
    gates:
      - submission
    deferred: true
`,
  "README.md": "not yaml; ignored by the loader",
};

/** The fixture Genome imported as `systemId`: only the root `node.yaml` names the System. */
export const genomeFor = (systemId: string): Record<string, string> =>
  ({ ...genomeFiles, "node.yaml": genomeFiles["node.yaml"]!.replace("id: system.kit", `id: ${systemId}`) });

export const appFiles: Record<string, string> = {
  "package.json": "{}",
  "wrangler.jsonc": "{}",
  "src/index.ts": "export default {}",
  "src/worker/health.ts": "ok",
  "src/ui/people/index.html": "<main></main>",
  "src/worker/routes/contacts.ts": "routes",
  "source-map.yaml": `
- glob: src/ui/people/**
  nodes: [screen.people, component.AddContactDialog]
- glob: src/worker/routes/contacts.ts
  nodes: [operation.contact.save, policy.ownerOnly, entity.ContactRecord]
`,
};

export const genomeMap = () => new Map(Object.entries(genomeFiles));
