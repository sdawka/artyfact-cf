/** A small Keep-in-Touch-shaped Genome on the real cloudflare-worker-webapp@1 template, plus an app tree. */
export const genomeFiles: Record<string, string> = {
  "system.yaml": `
id: system.kit
name: Keep in Touch (test)
template: null
things: [thing.webapp]
phase: unrealized
purposes: [P1]
`,
  "purpose.yaml": `
id: P1
statement: Help people keep in touch with the few people who matter.
beneficiaries: [ext.person]
intendedChange: People stay in touch without a feed.
successCriteria: [Owner contacts someone weekly]
nonGoals: [engagement]
`,
  "externals.yaml": `
externals:
  - id: ext.person
    kind: person
    name: Person
    modeled: Account and contacts
    external: Their relationships
`,
  "kits.yaml": `
kits: []
rulePacks:
  - { id: metamodel, version: "1" }
required: []
`,
  "description.yaml": `
narrative: A private contact list.
features:
  - { id: GD.people, name: People, summary: Keep a list of people }
commitments:
  - { id: commitment.private, statement: Contacts are private to their owner, features: [GD.people] }
`,
  "criteria.yaml": `
criteria:
  - id: C.system.promotion
    title: Changes stay in scope
    claim: A candidate only touches what its packet permits
    ownerKind: system
    ownerId: system.kit
    subjectKind: system
    subjectId: system.kit
    targetKind: artifact
    gates: [submission, promotion]
    hooks: [hook.system.scope]
hooks:
  - id: hook.system.scope
    assay: diff scope
    criteria: [C.system.promotion]
    tier: basic
    engine: diff
    targetKind: artifact
    triggers: [submission, promotion]
    binding: bound
`,
  "things/webapp/thing.yaml": `
id: thing.webapp
name: Keep in Touch web app
templateRef: template.thing.cloudflare-worker-webapp@1
description: The app
artifacts:
  - { artifact: artifact.webapp, type: worker-fullstack, repo: kit-app }
purposeRefs: [P1]
`,
  "things/webapp/ontology.yaml": `
nodes:
  - id: screen.people
    kind: screen
    name: People
    parent: section.ui
    route: /people
    children:
      - { id: component.AddContactDialog, kind: component, name: Add contact }
  - id: entity.ContactRecord
    kind: entity
    name: Contact record
    parent: section.domain
  - id: operation.contact.save
    kind: operation
    name: Save contact
    parent: section.domain
    links:
      - { rel: writes, to: entity.ContactRecord }
  - id: policy.ownerOnly
    kind: policy
    name: Owner only
    parent: section.authorization
    mode: owner-only
    links:
      - { rel: governs, to: operation.contact.save }
`,
  "things/webapp/criteria.yaml": `
criteria:
  - id: C.people.list
    title: People screen lists contacts
    claim: The People screen shows the owner's contacts
    ownerKind: thing
    ownerId: thing.webapp
    subjectKind: screen
    subjectId: screen.people
    targetKind: artifact
    gates: [submission, promotion]
    hooks: [hook.people.list]
  - id: C.people.sorted
    title: People are sorted by name
    claim: The People screen lists contacts alphabetically
    ownerKind: thing
    ownerId: thing.webapp
    subjectKind: screen
    subjectId: screen.people
    targetKind: artifact
    severity: soft
    gates: [submission, promotion]
  - id: C.people.later
    title: Deferred nicety
    claim: Later
    ownerKind: thing
    ownerId: thing.webapp
    subjectKind: screen
    subjectId: screen.people
    targetKind: artifact
    deferred: true
    gates: [submission]
hooks:
  - id: hook.people.list
    assay: people list test
    criteria: [C.people.list]
    tier: execution
    engine: vitest
    targetKind: artifact
    triggers: [submission]
`,
  "journeys/J.add.yaml": `
id: J.add
name: Add a contact
actorGoal: Owner records someone
features: [GD.people]
requirements: []
start: s1
steps:
  - { id: s1, actor: user, action: Open people, screen: screen.people, next: [{ to: s2 }] }
  - { id: s2, actor: user, action: Save contact, operation: operation.contact.save, next: [{ to: e1 }] }
  - { id: e1, actor: system, action: Done, kind: end }
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
  "README.md": "not yaml; ignored by the loader",
};

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
