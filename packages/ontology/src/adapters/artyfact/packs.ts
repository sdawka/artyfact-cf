import * as schema from "./schema.ts";

const CROSS = schema.Relation.options.map((r) => `crossRel("${r}").`).join("\n");

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
.decl ownKind(Kind: sym)
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
.decl athingListsSections(Thing: sym)
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

% Kinds with a shape of their own; every other kind is an ontology node. Where they sit in the tree does not matter:
% v1 left most of them parentless, the v2 tree places them under the System, a Thing or the node they constrain.
ownKind("system"). ownKind("thing"). ownKind("step"). ownKind("external"). ownKind("purpose"). ownKind("claim").
ownKind("feature"). ownKind("commitment"). ownKind("requirement"). ownKind("journey"). ownKind("criterion").
ownKind("hook"). ownKind("evolution"). ownKind("template"). ownKind("kit"). ownKind("artifact").
ontologyNode(N) :- node(N,K,_), not ownKind(K).
hasOwner(N) :- field(N,"owningThing",_).
pinsTemplate(T) :- node(T,"thing",_), link(T,"pinned",_,_).

anode(S,"system","") :- node(S,"system",_).
anode(T,"thing",T) :- node(T,"thing",_).
anode(E,"external","") :- node(E,"external",_).
anode(N,K,T) :- ontologyNode(N), node(N,K,_), field(N,"owningThing",T).
anode(N,K,"") :- ontologyNode(N), node(N,K,_), not hasOwner(N).
asystem(S) :- node(S,"system",_).
athing(T,Tpl) :- node(T,"thing",_), link(T,"pinned",Tpl,_).
athing(T,"") :- node(T,"thing",_), not pinsTemplate(T).
aparent(C,P) :- parent(C,P), ontologyNode(C).
aparent(T,P) :- parent(T,P), node(T,"thing",_).

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
% A Thing that lists no sections has the section nodes under it (v1 filled the list from its template).
athingListsSections(T) :- node(T,"thing",_), field(T,"sections",_).
athingSection(T,S) :- node(T,"thing",_), not athingListsSections(T), parent(S,T), node(S,"section",_).
arequirementEnabled(R) :- node(R,"requirement",_), field(R,"enabled","true").
acriterionDeferred(C) :- node(C,"criterion",_), field(C,"deferred","true").
acriterionSourceRef(C,R) :- node(C,"criterion",_), link(C,"sourceRef",R,_).
acriterionHook(C,H) :- node(C,"criterion",_), field(C,"hooks",H), node(H,"hook",_).
acriterionHook(C,H) :- node(H,"hook",_), field(H,"criteria",C).
ahook(H,B) :- node(H,"hook",_), field(H,"binding",B).
atemplateKnown(T) :- node(T,"template",_).
atemplateRequires(T,S) :- node(T,"template",_), field(T,"sections",S).
atemplateRequiresCriterion(T,C) :- node(T,"template",_), field(T,"criteria",C).
akitRequired(K) :- node(S,"system",_), link(S,"requires",K,_).
akitPinned(K,V) :- node(S,"system",_), link(S,"pinned",K,_), node(K,"kit",_), field(K,"version",V).
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
aext(E,K) :- node(E,"external",_), field(E,"kind",K).
apurpose(P) :- node(P,"purpose",_).
apurposeBeneficiary(P,E) :- apurpose(P), link(P,"beneficiary",E,_).
aclaim(C) :- node(C,"claim",_).
aclaimDeferred(C) :- aclaim(C), field(C,"deferred","true").
aclaimIndicator(C) :- aclaim(C), field(C,"indicator",V), matches(V,"[^ \\t\\n]").
aclaimMethod(C) :- aclaim(C), field(C,"evaluationMethod",V), matches(V,"[^ \\t\\n]").
aclaimBeneficiary(C,E) :- aclaim(C), link(C,"beneficiary",E,_).
arequirementSubject(R,N) :- node(R,"requirement",_), link(R,"subject",N,_).
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
violation("thing.sectionMissing",T,"hard") :- athingSection(T,S), not aknown(S).
` };
