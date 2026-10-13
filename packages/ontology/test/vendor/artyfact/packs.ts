// Verbatim copies of artyfact-cf packages/templates/rule-packs/*.dl, the parity reference.
export const authorization = { id: "authorization", version: "1", source: `
% authorization@1 - every state-changing operation is governed by a policy, directly or by inheritance.
% link/4 is emitted in "out" orientation: link(From, Rel, To, Certainty).

.decl node(Id: sym, Kind: sym, Thing: sym)
.decl parent(Child: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl policyMode(Policy: sym, Mode: sym)
.decl ancestor(X: sym, A: sym)
.decl governedDirect(X: sym, Policy: sym)
.decl governedBy(X: sym, Policy: sym)
.decl mutating(Op: sym)
.decl privateEntity(E: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "authz.ungoverned" "Operation {1} writes data but no authorization policy governs it (directly, via its affordances, or inherited)."
.message "authz.policyConflict" "{1} is directly governed by policies with different modes."
.message "authz.privateReadUngoverned" "Operation {1} reads an owner-only entity but no authorization policy governs it."

ancestor(X,A) :- parent(X,A).
ancestor(X,A) :- parent(X,Y), ancestor(Y,A).

governedDirect(X,P) :- link(P,"governs",X,_), node(P,"policy",_).
governedBy(X,P) :- governedDirect(X,P).
governedBy(X,P) :- ancestor(X,A), governedDirect(A,P).
governedBy(Op,P) :- link(Aff,"invokes",Op,_), governedBy(Aff,P).
governedBy(X,P) :- link(X,"inherits",Y,_), governedBy(Y,P).

mutating(Op) :- node(Op,"operation",_), link(Op,"writes",_,_).
privateEntity(E) :- governedBy(E,P), policyMode(P,"owner-only").

violation("authz.ungoverned",Op,"hard") :- mutating(Op), not governedBy(Op,_).
violation("authz.policyConflict",X,"hard") :- governedDirect(X,P1), governedDirect(X,P2), policyMode(P1,M1), policyMode(P2,M2), M1 != M2.
violation("authz.privateReadUngoverned",Op,"hard") :- link(Op,"reads",E,_), node(Op,"operation",_), privateEntity(E), not governedBy(Op,_).
` };
export const journeys = { id: "journeys", version: "1", source: `
% journeys@1 - screen/affordance completeness (R7) and journey well-formedness and coverage (R8).
% step(J,S) is emitted for every step; stepRef(J,S,Id) for every id a step mentions.

.decl known(Id: sym)
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl provisional(Id: sym)
.decl parent(Child: sym, Parent: sym)
.decl hasActor(Id: sym)
.decl hasEffects(Id: sym)
.decl journey(Id: sym, Start: sym)
.decl journeyDeferred(Id: sym)
.decl step(Journey: sym, Step: sym)
.decl stepEnd(Journey: sym, Step: sym)
.decl stepNext(Journey: sym, Step: sym, To: sym)
.decl stepRef(Journey: sym, Step: sym, Id: sym)
.decl stepScreen(Journey: sym, Step: sym, Screen: sym)
.decl stepOperation(Journey: sym, Step: sym, Operation: sym)
.decl stepUnresolved(Journey: sym, Step: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl missing(Rule: sym, Subject: sym) .output
.decl warning(Rule: sym, Subject: sym) .output

.message "journey.startMissing" "Journey {1} starts at a step that does not exist."
.message "journey.nextDangling" "Journey {1} has a step whose next step does not exist."
.message "journey.noEnd" "Journey {1} has no end step."
.message "journey.screenUncovered" "Screen {1} appears in no journey."
.message "journey.stepRefMissing" "Journey {1} has a step referring to an id that does not exist."
.message "screen.noComponents" "Screen {1} enumerates no components."
.message "affordance.incomplete" "Affordance {1} lacks an actor or effects."
.message "journey.operationUncovered" "Operation {1} is invoked by no journey step."

violation("journey.startMissing",J,"hard") :- journey(J,S), not step(J,S).
violation("journey.nextDangling",J,"hard") :- stepNext(J,_,T), not step(J,T).
violation("journey.stepRefMissing",J,"hard") :- stepRef(J,S,Id), not stepUnresolved(J,S), not known(Id).
missing("journey.noEnd",J) :- journey(J,_), not journeyDeferred(J), not stepEnd(J,_).
warning("journey.screenUncovered",S) :- node(S,"screen",_), not provisional(S), not stepScreen(_,_,S).
warning("journey.operationUncovered",O) :- node(O,"operation",_), not provisional(O), not stepOperation(_,_,O).

missing("screen.noComponents",S) :- node(S,"screen",_), not provisional(S), not parent(_,S).
missing("affordance.incomplete",A) :- node(A,"affordance",_), not provisional(A), not hasActor(A).
missing("affordance.incomplete",A) :- node(A,"affordance",_), not provisional(A), not hasEffects(A).
` };
export const metamodel = { id: "metamodel", version: "1", source: `
% metamodel@1 - structural integrity of the Genome (R1, R2, R10, R11).
% EDB relations are emitted by @artyfact/model toFacts(); see ../README.md "Fact relations".

.decl known(Id: sym)
.decl ref(From: sym, Via: sym, To: sym)
.decl parent(Child: sym, Parent: sym)
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl system(Id: sym)
.decl thing(Id: sym, Template: sym)
.decl criterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl thingArtifact(Thing: sym, Artifact: sym)
.decl thingSection(Thing: sym, Section: sym)
.decl reaches(X: sym, Y: sym)
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

reaches(X,Y) :- parent(X,Y).
reaches(X,Z) :- parent(X,Y), reaches(Y,Z).

violation("ref.dangling",From,"hard") :- ref(From,_,To), not known(To).
violation("ref.parentMissing",C,"hard") :- parent(C,P), not known(P).
violation("tree.cycle",X,"hard") :- reaches(X,X).
violation("tree.multiParent",X,"hard") :- parent(X,P1), parent(X,P2), P1 != P2.
violation("owner.unknown",N,"hard") :- node(N,_,T), T != "", not thing(T,_), not system(T).
violation("criterion.subjectMissing",C,"hard") :- criterion(C,_,_,S,_), not known(S).
violation("criterion.ownerMissing",C,"hard") :- criterion(C,"thing",O,_,_), not thing(O,_).
violation("criterion.ownerMissing",C,"hard") :- criterion(C,"system",O,_,_), not system(O).
violation("thing.noArtifact",T,"hard") :- thing(T,_), not thingArtifact(T,_).
violation("thing.sectionMissing",T,"hard") :- thingSection(T,S), not known(S).
` };
export const readiness = { id: "readiness", version: "1", source: `
% readiness@1 - is the Genome ready to be realized and verified? (R5, R6, R12, evolutions, kits).
% template.sectionMissing keys on the Thing's declared sections. template.criterionMissing only fires when an
% instance overrides a template criterion with a different owner (the loader always prepends template criteria).

.decl known(Id: sym)
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl thing(Id: sym, Template: sym)
.decl thingSection(Thing: sym, Section: sym)
.decl requirementEnabled(Id: sym)
.decl criterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl criterionDeferred(Id: sym)
.decl criterionSourceRef(Criterion: sym, Ref: sym)
.decl criterionHook(Criterion: sym, Hook: sym)
.decl hook(Id: sym, Binding: sym)
.decl templateKnown(Template: sym)
.decl templateRequires(Template: sym, Section: sym)
.decl templateRequiresCriterion(Template: sym, Criterion: sym)
.decl kitRequired(Kit: sym)
.decl kitPinned(Kit: sym, Version: sym)
.decl evolution(Id: sym, State: sym)
.decl evolutionAcceptance(Evolution: sym, Criterion: sym)
.decl evolutionAffects(Evolution: sym, Node: sym)
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

missing("coverage.requirement",R) :- requirementEnabled(R), not criterionSourceRef(_,R).
missing("coverage.hook",C) :- criterion(C,_,_,_,_), not criterionDeferred(C), not criterionHook(C,_).
warning("hook.unbound",C) :- criterionHook(C,H), hook(H,B), B != "bound", not criterionDeferred(C).

violation("template.sectionMissing",T,"hard") :- thing(T,Tpl), templateKnown(Tpl), templateRequires(Tpl,S), not thingSection(T,S).
violation("template.criterionMissing",T,"hard") :- thing(T,Tpl), templateKnown(Tpl), templateRequiresCriterion(Tpl,C), not criterion(C,_,T,_,_).
violation("template.unknown",T,"hard") :- thing(T,Tpl), Tpl != "", not templateKnown(Tpl).

warning("kit.unpinned",K) :- kitRequired(K), not kitPinned(K,_).

missing("evolution.acceptanceMissing",E) :- evolution(E,S), S != "rejected", S != "withdrawn", S != "promoted", not evolutionAcceptance(E,_).
missing("evolution.affectsMissing",E) :- evolution(E,S), S != "rejected", S != "withdrawn", S != "promoted", not evolutionAffects(E,_).
` };
export const theory = { id: "theory", version: "1", source: `
% theory@1 - Purpose and Theory of Change completeness (R3, R4).

.decl ext(Id: sym, Kind: sym)
.decl purpose(Id: sym)
.decl purposeBeneficiary(Purpose: sym, Ext: sym)
.decl claim(Id: sym)
.decl claimDeferred(Id: sym)
.decl claimIndicator(Id: sym)
.decl claimMethod(Id: sym)
.decl claimBeneficiary(Claim: sym, Ext: sym)
.decl criterion(Id: sym, OwnerKind: sym, OwnerId: sym, SubjectId: sym, Severity: sym)
.decl criterionSourceRef(Criterion: sym, Ref: sym)
.decl requirementSubject(Requirement: sym, Node: sym)
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

claimLinked(C) :- criterionSourceRef(_,C).
claimLinked(C) :- criterion(_,_,_,C,_).
claimLinked(C) :- requirementSubject(_,C).

violation("purpose.beneficiary",P,"hard") :- purpose(P), not purposeBeneficiary(P,_).
violation("purpose.beneficiaryKind",P,"hard") :- purposeBeneficiary(P,E), not ext(E,"person"), not ext(E,"group").

missing("theory.indicator",C) :- claim(C), not claimDeferred(C), not claimIndicator(C).
missing("theory.method",C) :- claim(C), not claimDeferred(C), not claimMethod(C).
missing("theory.beneficiary",C) :- claim(C), not claimDeferred(C), not claimBeneficiary(C,_).
warning("theory.outcomeUnlinked",C) :- claim(C), not claimDeferred(C), not claimLinked(C).
` };
export const topologyPrivatePairs = { id: "topology.private-pairs", version: "1", source: `
% topology.private-pairs@1 - private-relationships profile: relationships are one-to-one, never broadcast (R9).
% effectText(Node, Text) holds lowercased field names, effects and cardinality-bearing text of a node.
% nodeName/2 is lowercased too. entityField/3 carries the raw YAML type string (ref:entity.Account, list<ref:entity.Account>, ...).

.decl node(Id: sym, Kind: sym, Thing: sym)
.decl nodeName(Id: sym, Name: sym)
.decl effectText(Node: sym, Text: sym)
.decl cardinality(Node: sym, Value: sym)
.decl outgoingDirect(Node: sym)
.decl entityField(Entity: sym, Name: sym, Type: sym)
.decl provisional(Id: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl accountRefField(Entity: sym, Name: sym)
.decl connection(Entity: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output

.message "topology.recipientArray" "{1} sends to a list of recipients, which the private-pairs topology forbids."
.message "topology.groupEnabled" "{1} introduces a group construct; relationships must stay between exactly two accounts."
.message "topology.pairCardinality" "Connection {1} must declare exactly two account references."
.message "topology.multiRecipient" "{1} may address several recipients; ask whether it breaks one-to-one delivery."

violation("topology.recipientArray",N,"hard") :- effectText(N,T), contains(T,"recipient[]").
violation("topology.recipientArray",N,"hard") :- effectText(N,T), contains(T,"recipients[]").
violation("topology.recipientArray",N,"hard") :- effectText(N,T), contains(T,"recipient list").
violation("topology.recipientArray",N,"hard") :- effectText(N,T), contains(T,"bulk").
violation("topology.recipientArray",N,"hard") :- outgoingDirect(N), cardinality(N,"many").
violation("topology.recipientArray",E,"hard") :- node(E,"entity",_), not provisional(E), entityField(E,_,Ty), contains(Ty,"list<ref:entity.Account").

violation("topology.groupEnabled",N,"hard") :- node(N,K,_), K != "external", nodeName(N,Nm), matches(Nm,"^(group|circle|community|channel)( |$)").

connection(E) :- node(E,"entity",_), nodeName(E,"connection").
accountRefField(E,F) :- entityField(E,F,Ty), matches(Ty,"^ref:entity[.]Account").

% An operation that writes an entity addressing another account is an outgoing direct action;
% so is an affordance that invokes one. Used by topology.recipientArray with cardinality "many".
outgoingDirect(Op) :- node(Op,"operation",_), link(Op,"writes",E,_), accountRefField(E,_).
outgoingDirect(A) :- node(A,"affordance",_), link(A,"invokes",Op,_), outgoingDirect(Op).
violation("topology.pairCardinality",E,"hard") :- connection(E), not accountRefField(E,_).
violation("topology.pairCardinality",E,"hard") :- connection(E), N = count : accountRefField(E,_), N != 2.

semanticCandidate("topology.multiRecipient",N,T) :- effectText(N,T), contains(T,"recipient").
` };
