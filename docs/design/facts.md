# Fact schema (authoritative) — emitted by @artyfact/model toFacts(), consumed by rule packs

Source of truth: the `.decl` blocks in packages/templates/rule-packs/*.dl (branch w0-templates, commit 2677688). Identical redeclarations across packs are legal. Derived/IDB relations (ancestor, governedBy, governedDirect, mutating, reaches, privateEntity, claimLinked, connection, outgoingDirect?) are defined by packs; everything else is EDB from toFacts().

```
.decl ancestor(X: sym, A: sym)
.decl cardinality(Node: sym, Value: sym)
.decl claim(Id: sym)
.decl claimBeneficiary(Claim: sym, Ext: sym)
.decl claimDeferred(Id: sym)
.decl claimIndicator(Id: sym)
.decl claimLinked(Claim: sym)
.decl claimMethod(Id: sym)
.decl connection(Entity: sym)
.decl criterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl criterionDeferred(Id: sym)
.decl criterionHook(Criterion: sym, Hook: sym)
.decl criterionSourceRef(Criterion: sym, Ref: sym)
.decl effectText(Node: sym, Text: sym)
.decl entityField(Entity: sym, Name: sym, Type: sym)
.decl evolution(Id: sym, State: sym)
.decl evolutionAcceptance(Evolution: sym, Criterion: sym)
.decl evolutionAffects(Evolution: sym, Node: sym)
.decl ext(Id: sym, Kind: sym)
.decl governedBy(X: sym, Policy: sym)
.decl governedDirect(X: sym, Policy: sym)
.decl hook(Id: sym, Binding: sym)
.decl journey(Id: sym, Start: sym)
.decl journeyDeferred(Id: sym)
.decl kitPinned(Kit: sym, Version: sym)
.decl kitRequired(Kit: sym)
.decl known(Id: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl missing(Rule: sym, Subject: sym) .output
.decl mutating(Op: sym)
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl nodeName(Id: sym, Name: sym)
.decl outgoingDirect(Node: sym)
.decl parent(Child: sym, Parent: sym)
.decl policyMode(Policy: sym, Mode: sym)
.decl privateEntity(E: sym)
.decl provisional(Id: sym)
.decl purpose(Id: sym)
.decl purposeBeneficiary(Purpose: sym, Ext: sym)
.decl reaches(X: sym, Y: sym)
.decl ref(From: sym, Via: sym, To: sym)
.decl requirementEnabled(Id: sym)
.decl requirementSubject(Requirement: sym, Node: sym)
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output
.decl step(Journey: sym, Step: sym)
.decl stepEnd(Journey: sym, Step: sym)
.decl stepNext(Journey: sym, Step: sym, To: sym)
.decl stepOperation(Journey: sym, Step: sym, Operation: sym)
.decl stepRef(Journey: sym, Step: sym, Id: sym)
.decl stepScreen(Journey: sym, Step: sym, Screen: sym)
.decl stepUnresolved(Journey: sym, Step: sym)
.decl system(Id: sym)
.decl templateKnown(Template: sym)
.decl templateRequires(Template: sym, Section: sym)
.decl templateRequiresCriterion(Template: sym, Criterion: sym)
.decl thing(Id: sym, Template: sym)
.decl thingArtifact(Thing: sym, Artifact: sym)
.decl thingSection(Thing: sym, Section: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl warning(Rule: sym, Subject: sym) .output
```

Conventions:
- `link(From, Rel, To, Certainty)` is emitted in OUT orientation only: a YAML link with `direction: in` on node N (`{rel: governs, to: P, direction: in}`) is emitted as `link(P, "governs", N, c)`.
- `ref(From, Via, To)` = every id reference that must resolve (parent, refines, subjects, sourceRefs, beneficiaries, acceptanceCriteria, step screen/operation/external, link targets) with `Via` naming the field; `known(Id)` = every declared id of any kind (nodes, externals, criteria, hooks, requirements, journeys, steps as "J.x/s1", evolutions, templates, purposes, claims, kits).
- `thing(Id, TemplateRef|"")`, `templateKnown(T)` for every resolvable template id@version, `templateRequires(T, Section)`, `templateRequiresCriterion(T, Crit)`.
- `criterion(Id, OwnerKind, OwnerId, SubjectId, Severity)`, `criterionDeferred/1`, `criterionSourceRef/2`, `criterionHook/2`, `hook(Id, Binding)`.
- `policyMode(Policy, Mode)` from a new optional `mode: string` field on policy nodes (schema change: add `mode?: string` to OntologyNode; Keep in Touch sets `policy.ownerOnly.mode = "owner-only"`, `policy.pairConsent.mode = "pair-consent"`, `policy.revocation.mode = "revocation"`).
- `effectText/2` and `nodeName/2` values are lowercased; `entityField(Entity, Name, Type)` raw type strings; `cardinality(Node, Value)`.
- `evolution(Id, State)`, `evolutionAcceptance/2`, `evolutionAffects/2`, `requirementEnabled/1`, `requirementSubject/2`, `purpose/1`, `purposeBeneficiary/2`, `claim/1`, `claimDeferred/1`, `claimIndicator/1`, `claimMethod/1`, `claimBeneficiary/2`, `ext(Id, Kind)`, `journey(Id, Start)`, `journeyDeferred/1`, `step/2`, `stepNext/3`, `stepScreen/3`, `stepOperation/3`, `stepRef/3`, `stepEnd/2`, `stepUnresolved/2`, `kitRequired/1`, `kitPinned/2`, `provisional/1`, `thingArtifact/2`, `thingSection/2`, `system/1`, `parent(Child, Parent)`.
- `node(Id, Kind, Thing)`: ontology nodes, plus the System (Kind "system", Thing ""), each Thing (Kind "thing", Thing = its own id) and each External (Kind "external", Thing ""); rules that mean ontology nodes only must constrain Kind. `known/1` remains the universal id set.
- Placeholders: template nodes use `"$thing"` / `"$system"` for parent/owningThing; the loader rebases them.
- `.message "rule-id" "text {1} {2}"`: `{n}` = nth argument AFTER the rule id (so `{1}` = Subject for violation/missing/warning).

## Amendments (rulings after templates review)
- `template.sectionMissing(T)` is keyed on `thingSection(T, Sec)` (the Thing's declared `sections`), NOT on `node(...)`, because the loader always prepends template nodes.
- R7 gets rules in journeys@1: `missing("screen.noComponents", S) :- node(S,"screen",_), not provisional(S), not parent(_,S).` and `missing("affordance.incomplete", A) :- node(A,"affordance",_), not provisional(A), not hasActor(A).` / `... not hasEffects(A).` New EDB facts: `hasActor(Id)` (affordance.actor non-empty), `hasEffects(Id)` (effects non-empty).
- `entityField(Entity, Name, Type)` carries the raw YAML type string (e.g. `ref:entity.Account`, `list<ref:entity.Account>`, `int 1..3650`). `topology.pairCardinality` must count fields whose type starts with `ref:entity.Account`; `topology.recipientArray` fires on types matching `^list<ref:entity\.Account` for non-provisional entities (so the pack must `.decl provisional`).
- `semanticCandidate("topology.multiRecipient", N, Text)` is emitted for every `effectText` containing "recipient" (plain `contains`), no further regex — the semantic layer decides.
- `kits.yaml` schema: `{ kits: [{id, version}], rulePacks: [{id, version}], required: [kitId] }`; `packsFor(model.kits.rulePacks)` is the call. `kitRequired/1` from `required`, `kitPinned/2` from `kits`.
