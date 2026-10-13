import * as schema from "./schema.ts";

const CROSS = schema.Relation.options.map((r) => `crossRel("${r}").`).join("\n");

/** A regex matching `s` case-insensitively, as a .dl string body. artyfact lowercases effects and names; the dialect cannot. */
const ci = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&").replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
  .replace(/\\/g, "\\\\");

/** artyfact's fact relations (docs/design/facts.md) derived from the generic EDB, prefixed `a` where a name is taken. */
export const facts = { id: "artyfact.facts", version: "1", source: `
% artyfact.facts@1 - artyfact's EDB relations rebuilt from the canonical graph.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl parent(Child: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl known(Id: sym)
.decl crossRel(Rel: sym)
.decl ontologyNode(Id: sym)
.decl hasOwner(Id: sym)
.decl pinsTemplate(Thing: sym)
.decl anode(Id: sym, Kind: sym, Thing: sym)
.decl asystem(Id: sym)
.decl athing(Id: sym, Template: sym)
.decl aparent(Child: sym, Parent: sym)
.decl aknown(Id: sym)
.decl aref(From: sym, Via: sym, To: sym)
.decl acriterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl athingArtifact(Thing: sym, Artifact: sym)
.decl athingSection(Thing: sym, Section: sym)
.decl arequirementEnabled(Id: sym)
.decl acriterionDeferred(Id: sym)
.decl acriterionSourceRef(Criterion: sym, Ref: sym)
.decl acriterionHook(Criterion: sym, Hook: sym)
.decl ahook(Id: sym, Binding: sym)
.decl atemplateKnown(Template: sym)
.decl atemplateRequires(Template: sym, Section: sym)
.decl atemplateRequiresCriterion(Template: sym, Criterion: sym)
.decl akitRequired(Kit: sym)
.decl akitPinned(Kit: sym, Version: sym)
.decl aevolution(Id: sym, State: sym)
.decl aevolutionAcceptance(Evolution: sym, Criterion: sym)
.decl aevolutionAffects(Evolution: sym, Node: sym)
.decl apolicyMode(Policy: sym, Mode: sym)
.decl aeffectText(Node: sym, Text: sym)
.decl anodeName(Id: sym, Name: sym)
.decl aentityField(Entity: sym, Field: sym)
.decl acardinality(Node: sym, Value: sym)
.decl ahasActor(Id: sym)
.decl ahasEffects(Id: sym)
.decl aext(Id: sym, Kind: sym)
.decl apurpose(Id: sym)
.decl apurposeBeneficiary(Purpose: sym, Ext: sym)
.decl aclaim(Id: sym)
.decl aclaimDeferred(Id: sym)
.decl aclaimIndicator(Id: sym)
.decl aclaimMethod(Id: sym)
.decl aclaimBeneficiary(Claim: sym, Ext: sym)
.decl arequirementSubject(Requirement: sym, Node: sym)
.decl ajourney(Id: sym, Start: sym)
.decl ajourneyDeferred(Id: sym)
.decl astepOf(Key: sym, Journey: sym, Step: sym)
.decl astep(Journey: sym, Step: sym)
.decl astepEnd(Journey: sym, Step: sym)
.decl astepUnresolved(Journey: sym, Step: sym)
.decl astepNextDangling(Journey: sym)
.decl astepScreen(Screen: sym)
.decl astepOperation(Operation: sym)
.decl astepRef(Journey: sym, Step: sym, Id: sym)
.decl stepRefRel(Rel: sym)

${CROSS}
stepRefRel("stepScreen").
stepRefRel("stepOperation").
stepRefRel("stepExternal").

ontologyNode(N) :- node(N,K,P), P != "", K != "thing", K != "step".
hasOwner(N) :- field(N,"owningThing",_).
pinsTemplate(T) :- node(T,"thing",_), link(T,"pinned",_,_).

anode(S,"system","") :- node(S,"system","").
anode(T,"thing",T) :- node(T,"thing",_).
anode(E,"external","") :- node(E,"external","").
anode(N,K,T) :- ontologyNode(N), node(N,K,_), field(N,"owningThing",T).
anode(N,K,"") :- ontologyNode(N), node(N,K,_), not hasOwner(N).
asystem(S) :- node(S,"system","").
athing(T,Tpl) :- node(T,"thing",_), link(T,"pinned",Tpl,_).
athing(T,"") :- node(T,"thing",_), not pinsTemplate(T).
aparent(C,P) :- parent(C,P), node(C,K,_), K != "step".

aknown(X) :- node(X,K,_), K != "artifact", K != "kit".
aknown(K) :- link(_,"pinned",K,_), node(K,"kit",_).

aref(N,"parent",P) :- ontologyNode(N), parent(N,P).
aref(F,"refines",T) :- link(F,"refines",T,_).
aref(F,"links",T) :- link(F,R,T,_), crossRel(R), not node(F,"evolution",_).
aref(F,"beneficiaries",T) :- link(F,"beneficiary",T,_).
aref(F,"subjects",T) :- link(F,"subject",T,_), node(F,"requirement",_).
aref(F,"sourceRefs",T) :- link(F,"sourceRef",T,_).
aref(F,"acceptanceCriteria",T) :- link(F,"acceptance",T,_).
aref(F,"screen",T) :- link(F,"stepScreen",T,_).
aref(F,"operation",T) :- link(F,"stepOperation",T,_).
aref(F,"external",T) :- link(F,"stepExternal",T,_).

acriterion(C,OK,O,S,Sev) :- node(C,"criterion",_), field(C,"ownerKind",OK), link(C,"owner",O,_), link(C,"subject",S,_), field(C,"severity",Sev).
athingArtifact(T,A) :- node(T,"thing",_), link(T,"artifact",A,_).
athingSection(T,S) :- node(T,"thing",_), field(T,"sections",S).
arequirementEnabled(R) :- node(R,"requirement",""), field(R,"enabled","true").
acriterionDeferred(C) :- node(C,"criterion",_), field(C,"deferred","true").
acriterionSourceRef(C,R) :- node(C,"criterion",_), link(C,"sourceRef",R,_).
acriterionHook(C,H) :- node(C,"criterion",_), field(C,"hooks",H), node(H,"hook",_).
acriterionHook(C,H) :- node(H,"hook",_), field(H,"criteria",C).
ahook(H,B) :- node(H,"hook",_), field(H,"binding",B).
atemplateKnown(T) :- node(T,"template",_).
atemplateRequires(T,S) :- node(T,"template",_), field(T,"sections",S).
atemplateRequiresCriterion(T,C) :- node(T,"template",_), field(T,"criteria",C).
akitRequired(K) :- node(S,"system",""), link(S,"requires",K,_).
akitPinned(K,V) :- node(S,"system",""), link(S,"pinned",K,_), node(K,"kit",_), field(K,"version",V).
aevolution(E,S) :- node(E,"evolution",_), field(E,"state",S).
aevolutionAcceptance(E,C) :- node(E,"evolution",_), link(E,"acceptance",C,_).
aevolutionAffects(E,N) :- node(E,"evolution",_), link(E,"affects",N,_).

apolicyMode(P,M) :- ontologyNode(P), node(P,"policy",_), field(P,"mode",M).
aeffectText(N,T) :- ontologyNode(N), field(N,"effects",T).
anodeName(N,Nm) :- anode(N,_,_), field(N,"name",Nm).
aentityField(E,F) :- ontologyNode(E), node(E,"entity",_), field(E,"fields",F).
acardinality(N,V) :- ontologyNode(N), field(N,"cardinality",V).
ahasActor(A) :- ontologyNode(A), node(A,"affordance",_), field(A,"actor",_).
ahasEffects(A) :- ontologyNode(A), node(A,"affordance",_), field(A,"effects",_).
aext(E,K) :- node(E,"external",""), field(E,"kind",K).
apurpose(P) :- node(P,"purpose","").
apurposeBeneficiary(P,E) :- apurpose(P), link(P,"beneficiary",E,_).
aclaim(C) :- node(C,"claim","").
aclaimDeferred(C) :- aclaim(C), field(C,"deferred","true").
aclaimIndicator(C) :- aclaim(C), field(C,"indicator",V), matches(V,"[^ \\t\\n]").
aclaimMethod(C) :- aclaim(C), field(C,"evaluationMethod",V), matches(V,"[^ \\t\\n]").
aclaimBeneficiary(C,E) :- aclaim(C), link(C,"beneficiary",E,_).
arequirementSubject(R,N) :- node(R,"requirement",""), link(R,"subject",N,_).
ajourney(J,S) :- node(J,"journey",_), field(J,"start",S).
ajourneyDeferred(J) :- node(J,"journey",_), field(J,"deferred","true").
astepOf(K,J,S) :- node(K,"step",J), field(K,"step",S).
astep(J,S) :- astepOf(_,J,S).
astepEnd(J,S) :- astepOf(K,J,S), field(K,"kind","end").
astepUnresolved(J,S) :- astepOf(K,J,S), field(K,"unresolved","true").
astepNextDangling(J) :- astepOf(K,J,_), link(K,"stepNext",T,_), not node(T,"step",J).
astepScreen(S) :- link(_,"stepScreen",S,_).
astepScreen(S) :- node(K,"step",_), field(K,"screen",S).
astepOperation(O) :- link(_,"stepOperation",O,_).
astepOperation(O) :- node(K,"step",_), field(K,"operation",O).
astepRef(J,S,Id) :- astepOf(K,J,S), link(K,R,Id,_), stepRefRel(R).
astepRef(J,S,Id) :- astepOf(K,J,S), field(K,"requirementRefs",Id).
` };

export const metamodel = { id: "artyfact.metamodel", version: "1", source: `
% artyfact.metamodel@1 - artyfact metamodel@1 (R1, R2, R10, R11) over artyfact.facts@1; rule ids unchanged.

.decl aknown(Id: sym)
.decl aref(From: sym, Via: sym, To: sym)
.decl aparent(Child: sym, Parent: sym)
.decl anode(Id: sym, Kind: sym, Thing: sym)
.decl asystem(Id: sym)
.decl athing(Id: sym, Template: sym)
.decl acriterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl athingArtifact(Thing: sym, Artifact: sym)
.decl athingSection(Thing: sym, Section: sym)
.decl areaches(X: sym, Y: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "ref.dangling" "{1} refers to an id that does not exist in the model."
.message "ref.parentMissing" "{1} is contained in a parent that does not exist."
.message "tree.cycle" "{1} is part of a containment cycle."
.message "tree.multiParent" "{1} has more than one containment parent."
.message "owner.unknown" "Node {1} is owned by a Thing or System that does not exist."
.message "criterion.subjectMissing" "Criterion {1} has a subject that does not exist."
.message "criterion.ownerMissing" "Criterion {1} is owned by a System or Thing that does not exist."
.message "thing.noArtifact" "Thing {1} binds no artifact."
.message "thing.sectionMissing" "Thing {1} lists a section that does not exist."

areaches(X,Y) :- aparent(X,Y).
areaches(X,Z) :- aparent(X,Y), areaches(Y,Z).

violation("ref.dangling",From,"hard") :- aref(From,_,To), not aknown(To).
violation("ref.parentMissing",C,"hard") :- aparent(C,P), not aknown(P).
violation("tree.cycle",X,"hard") :- areaches(X,X).
violation("tree.multiParent",X,"hard") :- aparent(X,P1), aparent(X,P2), P1 != P2.
violation("owner.unknown",N,"hard") :- anode(N,_,T), T != "", not athing(T,_), not asystem(T).
violation("criterion.subjectMissing",C,"hard") :- acriterion(C,_,_,S,_), not aknown(S).
violation("criterion.ownerMissing",C,"hard") :- acriterion(C,"thing",O,_,_), not athing(O,_).
violation("criterion.ownerMissing",C,"hard") :- acriterion(C,"system",O,_,_), not asystem(O).
violation("thing.noArtifact",T,"hard") :- athing(T,_), not athingArtifact(T,_).
violation("thing.sectionMissing",T,"hard") :- athingSection(T,S), not aknown(S).
` };

export const readiness = { id: "artyfact.readiness", version: "1", source: `
% artyfact.readiness@1 - artyfact readiness@1 (R5, R6, R12, evolutions, kits) over artyfact.facts@1; rule ids unchanged.

.decl athing(Id: sym, Template: sym)
.decl athingSection(Thing: sym, Section: sym)
.decl arequirementEnabled(Id: sym)
.decl acriterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl acriterionDeferred(Id: sym)
.decl acriterionSourceRef(Criterion: sym, Ref: sym)
.decl acriterionHook(Criterion: sym, Hook: sym)
.decl ahook(Id: sym, Binding: sym)
.decl atemplateKnown(Template: sym)
.decl atemplateRequires(Template: sym, Section: sym)
.decl atemplateRequiresCriterion(Template: sym, Criterion: sym)
.decl akitRequired(Kit: sym)
.decl akitPinned(Kit: sym, Version: sym)
.decl aevolution(Id: sym, State: sym)
.decl aevolutionAcceptance(Evolution: sym, Criterion: sym)
.decl aevolutionAffects(Evolution: sym, Node: sym)
.decl missing(Rule: sym, Subject: sym) .output
.decl warning(Rule: sym, Subject: sym) .output
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "coverage.requirement" "Requirement {1} is enabled but no criterion lists it in sourceRefs."
.message "coverage.hook" "Criterion {1} is not deferred but has no assay hook."
.message "hook.unbound" "Criterion {1} has a hook whose implementation is missing."
.message "template.sectionMissing" "Thing {1} lacks a section its template requires."
.message "template.criterionMissing" "Thing {1} lacks a criterion its template requires."
.message "template.unknown" "Thing {1} references a template that is not known."
.message "kit.unpinned" "Kit {1} is required but not pinned."
.message "evolution.acceptanceMissing" "Evolution {1} has no acceptance criteria."
.message "evolution.affectsMissing" "Evolution {1} affects no nodes."

missing("coverage.requirement",R) :- arequirementEnabled(R), not acriterionSourceRef(_,R).
missing("coverage.hook",C) :- acriterion(C,_,_,_,_), not acriterionDeferred(C), not acriterionHook(C,_).
warning("hook.unbound",C) :- acriterionHook(C,H), ahook(H,B), B != "bound", not acriterionDeferred(C).

violation("template.sectionMissing",T,"hard") :- athing(T,Tpl), atemplateKnown(Tpl), atemplateRequires(Tpl,S), not athingSection(T,S).
violation("template.criterionMissing",T,"hard") :- athing(T,Tpl), atemplateKnown(Tpl), atemplateRequiresCriterion(Tpl,C), not acriterion(C,_,T,_,_).
violation("template.unknown",T,"hard") :- athing(T,Tpl), Tpl != "", not atemplateKnown(Tpl).

warning("kit.unpinned",K) :- akitRequired(K), not akitPinned(K,_).

missing("evolution.acceptanceMissing",E) :- aevolution(E,S), S != "rejected", S != "withdrawn", S != "promoted", not aevolutionAcceptance(E,_).
missing("evolution.affectsMissing",E) :- aevolution(E,S), S != "rejected", S != "withdrawn", S != "promoted", not aevolutionAffects(E,_).
` };

export const authorization = { id: "artyfact.authorization", version: "1", source: `
% artyfact.authorization@1 - every state-changing operation is governed by a policy, directly or by inheritance.

.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl anode(Id: sym, Kind: sym, Thing: sym)
.decl aparent(Child: sym, Parent: sym)
.decl apolicyMode(Policy: sym, Mode: sym)
.decl ancestor(X: sym, A: sym)
.decl governedDirect(X: sym, Policy: sym)
.decl governedBy(X: sym, Policy: sym)
.decl mutating(Op: sym)
.decl privateEntity(E: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "authz.ungoverned" "Operation {1} writes data but no authorization policy governs it (directly, via its affordances, or inherited)."
.message "authz.policyConflict" "{1} is directly governed by policies with different modes."
.message "authz.privateReadUngoverned" "Operation {1} reads an owner-only entity but no authorization policy governs it."

ancestor(X,A) :- aparent(X,A).
ancestor(X,A) :- aparent(X,Y), ancestor(Y,A).
governedDirect(X,P) :- link(P,"governs",X,_), anode(P,"policy",_).
governedBy(X,P) :- governedDirect(X,P).
governedBy(X,P) :- ancestor(X,A), governedDirect(A,P).
governedBy(Op,P) :- link(Aff,"invokes",Op,_), governedBy(Aff,P).
governedBy(X,P) :- link(X,"inherits",Y,_), governedBy(Y,P).
mutating(Op) :- anode(Op,"operation",_), link(Op,"writes",_,_).
privateEntity(E) :- governedBy(E,P), apolicyMode(P,"owner-only").

violation("authz.ungoverned",Op,"hard") :- mutating(Op), not governedBy(Op,_).
violation("authz.policyConflict",X,"hard") :- governedDirect(X,P1), governedDirect(X,P2), apolicyMode(P1,M1), apolicyMode(P2,M2), M1 != M2.
violation("authz.privateReadUngoverned",Op,"hard") :- link(Op,"reads",E,_), anode(Op,"operation",_), privateEntity(E), not governedBy(Op,_).
` };

export const journeys = { id: "artyfact.journeys", version: "1", source: `
% artyfact.journeys@1 - screen and affordance completeness (R7), journey well-formedness and coverage (R8).

.decl provisional(Id: sym)
.decl anode(Id: sym, Kind: sym, Thing: sym)
.decl aparent(Child: sym, Parent: sym)
.decl aknown(Id: sym)
.decl ahasActor(Id: sym)
.decl ahasEffects(Id: sym)
.decl ajourney(Id: sym, Start: sym)
.decl ajourneyDeferred(Id: sym)
.decl astep(Journey: sym, Step: sym)
.decl astepEnd(Journey: sym, Step: sym)
.decl astepUnresolved(Journey: sym, Step: sym)
.decl astepNextDangling(Journey: sym)
.decl astepScreen(Screen: sym)
.decl astepOperation(Operation: sym)
.decl astepRef(Journey: sym, Step: sym, Id: sym)
.decl hasChild(Node: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl missing(Rule: sym, Subject: sym) .output
.decl warning(Rule: sym, Subject: sym) .output

.message "journey.startMissing" "Journey {1} starts at a step that does not exist."
.message "journey.nextDangling" "Journey {1} has a step whose next step does not exist."
.message "journey.stepRefMissing" "Journey {1} has a step referring to an id that does not exist."
.message "journey.noEnd" "Journey {1} has no end step."
.message "journey.screenUncovered" "Screen {1} appears in no journey."
.message "journey.operationUncovered" "Operation {1} is invoked by no journey step."
.message "screen.noComponents" "Screen {1} enumerates no components."
.message "affordance.incomplete" "Affordance {1} lacks an actor or effects."

hasChild(P) :- aparent(_,P).

violation("journey.startMissing",J,"hard") :- ajourney(J,S), not astep(J,S).
violation("journey.nextDangling",J,"hard") :- astepNextDangling(J).
violation("journey.stepRefMissing",J,"hard") :- astepRef(J,S,Id), not astepUnresolved(J,S), not aknown(Id).
missing("journey.noEnd",J) :- ajourney(J,_), not ajourneyDeferred(J), not astepEnd(J,_).
warning("journey.screenUncovered",S) :- anode(S,"screen",_), not provisional(S), not astepScreen(S).
warning("journey.operationUncovered",O) :- anode(O,"operation",_), not provisional(O), not astepOperation(O).
missing("screen.noComponents",S) :- anode(S,"screen",_), not provisional(S), not hasChild(S).
missing("affordance.incomplete",A) :- anode(A,"affordance",_), not provisional(A), not ahasActor(A).
missing("affordance.incomplete",A) :- anode(A,"affordance",_), not provisional(A), not ahasEffects(A).
` };

export const theory = { id: "artyfact.theory", version: "1", source: `
% artyfact.theory@1 - Purpose and Theory of Change completeness (R3, R4).

.decl acriterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl acriterionSourceRef(Criterion: sym, Ref: sym)
.decl arequirementSubject(Requirement: sym, Node: sym)
.decl apurpose(Id: sym)
.decl apurposeBeneficiary(Purpose: sym, Ext: sym)
.decl aext(Id: sym, Kind: sym)
.decl aclaim(Id: sym)
.decl aclaimDeferred(Id: sym)
.decl aclaimIndicator(Id: sym)
.decl aclaimMethod(Id: sym)
.decl aclaimBeneficiary(Claim: sym, Ext: sym)
.decl claimLinked(Claim: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl missing(Rule: sym, Subject: sym) .output
.decl warning(Rule: sym, Subject: sym) .output

.message "purpose.beneficiary" "Purpose {1} names no beneficiaries."
.message "purpose.beneficiaryKind" "Purpose {1} has a beneficiary that is not a person or group external (or does not exist)."
.message "theory.indicator" "Claim {1} has no indicator."
.message "theory.method" "Claim {1} has no evaluation method."
.message "theory.beneficiary" "Claim {1} names no beneficiaries."
.message "theory.outcomeUnlinked" "Claim {1} is not referenced by any criterion or requirement."

claimLinked(C) :- acriterionSourceRef(_,C).
claimLinked(C) :- acriterion(_,_,_,C,_).
claimLinked(C) :- arequirementSubject(_,C).

violation("purpose.beneficiary",P,"hard") :- apurpose(P), not apurposeBeneficiary(P,_).
violation("purpose.beneficiaryKind",P,"hard") :- apurposeBeneficiary(P,E), not aext(E,"person"), not aext(E,"group").
missing("theory.indicator",C) :- aclaim(C), not aclaimDeferred(C), not aclaimIndicator(C).
missing("theory.method",C) :- aclaim(C), not aclaimDeferred(C), not aclaimMethod(C).
missing("theory.beneficiary",C) :- aclaim(C), not aclaimDeferred(C), not aclaimBeneficiary(C,_).
warning("theory.outcomeUnlinked",C) :- aclaim(C), not aclaimDeferred(C), not claimLinked(C).
` };

const typeIs = (re: string) => `,.type.:.${re}`;

export const topologyPrivatePairs = { id: "artyfact.topology.private-pairs", version: "1", source: `
% artyfact.topology.private-pairs@1 - private-relationships profile: relationships are one-to-one, never broadcast (R9).
% artyfact lowercases effect text and names; the patterns here match case-insensitively instead.
% aentityField(E, F) is one canonical JSON field object; its type key sorts last.

.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl provisional(Id: sym)
.decl anode(Id: sym, Kind: sym, Thing: sym)
.decl aeffectText(Node: sym, Text: sym)
.decl anodeName(Id: sym, Name: sym)
.decl aentityField(Entity: sym, Field: sym)
.decl acardinality(Node: sym, Value: sym)
.decl connection(Entity: sym)
.decl accountRefField(Entity: sym, Field: sym)
.decl outgoingDirect(Node: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output

.message "topology.recipientArray" "{1} sends to a list of recipients, which the private-pairs topology forbids."
.message "topology.groupEnabled" "{1} introduces a group construct; relationships must stay between exactly two accounts."
.message "topology.pairCardinality" "Connection {1} must declare exactly two account references."
.message "topology.multiRecipient" "{1} may address several recipients; ask whether it breaks one-to-one delivery."

violation("topology.recipientArray",N,"hard") :- aeffectText(N,T), matches(T,"${ci("recipient[]")}").
violation("topology.recipientArray",N,"hard") :- aeffectText(N,T), matches(T,"${ci("recipients[]")}").
violation("topology.recipientArray",N,"hard") :- aeffectText(N,T), matches(T,"${ci("recipient list")}").
violation("topology.recipientArray",N,"hard") :- aeffectText(N,T), matches(T,"${ci("bulk")}").
violation("topology.recipientArray",N,"hard") :- outgoingDirect(N), acardinality(N,"many").
violation("topology.recipientArray",E,"hard") :- anode(E,"entity",_), not provisional(E), aentityField(E,F), matches(F,"${typeIs(".*list<ref:entity[.]Account")}").
violation("topology.groupEnabled",N,"hard") :- anode(N,K,_), K != "external", anodeName(N,Nm), matches(Nm,"^(${["group", "circle", "community", "channel"].map(ci).join("|")})( |$)").
connection(E) :- anode(E,"entity",_), anodeName(E,Nm), matches(Nm,"^${ci("connection")}$").
accountRefField(E,F) :- aentityField(E,F), matches(F,"${typeIs("ref:entity[.]Account")}").
outgoingDirect(Op) :- anode(Op,"operation",_), link(Op,"writes",E,_), accountRefField(E,_).
outgoingDirect(A) :- anode(A,"affordance",_), link(A,"invokes",Op,_), outgoingDirect(Op).
violation("topology.pairCardinality",E,"hard") :- connection(E), not accountRefField(E,_).
violation("topology.pairCardinality",E,"hard") :- connection(E), N = count : accountRefField(E,_), N != 2.
semanticCandidate("topology.multiRecipient",N,T) :- aeffectText(N,T), matches(T,"${ci("recipient")}").
` };
