/**
 * world.readiness@1 - the checks of world-core's `evaluate_readiness` that the generic core packs do not
 * already make, with rule ids equal to the Rust finding codes. Template data the checks need (required
 * relations with object kind and scope, endpoint pairs, required and compiled rule packs, thing templates)
 * reaches the pack as prefilled template nodes, so every derivation ends in EDB facts.
 */
export const worldReadiness = { id: "world.readiness", version: "1", source: `
% world.readiness@1 - world-core readiness checks over the generic graph.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl known(Id: sym)
.decl declared(Scope: sym, Status: sym)
.decl requiredField(Kind: sym, Field: sym)
.decl forbiddenCycle(Id: sym, Rel: sym)
.decl incompatible(Id: sym, Kind: sym, Field: sym, Value: sym)
.decl incompatibleSize(Id: sym, Size: num)

.decl hasField(Node: sym, Field: sym)
.decl snapshotField(Field: sym, Value: sym)
.decl worldId(W: sym)
.decl worldObject(N: sym)
.decl rootMatches(W: sym)
.decl resolvedTemplate(Thing: sym, Template: sym)
.decl compatibleWith(Template: sym, WorldRef: sym)
.decl compiledPin(Pin: sym)
.decl requiredPin(Pin: sym)
.decl pinned(Pin: sym)
.decl duplicate(Collection: sym, Node: sym)
.decl dupScope(Scope: sym)
.decl scopeComplete(Scope: sym)
.decl endpointLegal(From: sym, Rel: sym, To: sym)
.decl objectLink(From: sym, Rel: sym, To: sym)
.decl reqSatisfied(Req: sym, Subject: sym)
.decl reqOpen(Req: sym, Rule: sym, Subject: sym, Scope: sym)
.decl cyclePath(Id: sym, X: sym, Y: sym)
.decl incompatibleHit(Id: sym, Node: sym, Field: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl missing(Rule: sym, Subject: sym) .output

.message "core.world-root" "A snapshot requires exactly one root World object matching worldId {1}."
.message "core.ids-unique" "{1}: IDs must be unique."
.message "core.shape-ids-unique" "{1}: shape IDs and runtime kinds must be unique."
.message "core.thing-template-definitions-unique" "{1}: Thing Template ID/version pairs must be unique."
.message "core.thing-references-pinned" "Thing {1} must pin both a revision and Template reference."
.message "core.thing-template-resolves" "Thing {1} references a missing Thing Template."
.message "core.thing-template-compatible" "Thing {1} uses a Thing Template incompatible with the World Template."
.message "core.thing-template-inherits-context" "Thing {1} uses a Thing Template that does not inherit pinned World context."
.message "core.thing-template-capabilities" "Thing {1} capabilities do not match its Thing Template."
.message "core.world-references-pinned" "World {1} must pin its revision and Template ID/version."
.message "core.rule-packs-pinned" "{1}: Rule Pack IDs must be unique and each version must be pinned."
.message "core.compiled-rule-packs" "Rule Pack {1} is not compiled into bropilot-readiness@1."
.message "core.required-rule-packs" "The World Template requires compiled Rule Pack {1}."
.message "core.completeness-declarations-unique" "{1} has duplicate completeness declarations."
.message "core.references-resolve" "{1} is referenced but does not exist."
.message "core.typed-references" "{1} is referenced with a kind the reference does not allow."
.message "core.shape-required-properties" "Object {1} is missing properties its shape requires."
.message "core.relation-endpoints-legal" "A relation from {1} connects kinds no allowed endpoint pair permits."

hasField(N,F) :- field(N,F,_).
snapshotField(F,V) :- node(S,"ws.snapshot",_), field(S,F,V).
worldId(W) :- snapshotField("worldId",W).

% World root: exactly one world object, and it is the root named by worldId.
worldObject(N) :- node(N,"world",_).
rootMatches(W) :- worldId(W), node(W,"world","").
violation("core.world-root",W,"hard") :- worldId(W), not rootMatches(W).
violation("core.world-root",W,"hard") :- worldId(W), C = count : worldObject(_), C > 1.

% Duplicates the loader recorded; the graph itself is a set.
duplicate(C,D) :- node(D,"ws.duplicate",_), field(D,"collection",C).
violation("core.ids-unique",D,"hard") :- duplicate("objects",D).
violation("core.ids-unique",D,"hard") :- duplicate("things",D).
violation("core.ids-unique",D,"hard") :- duplicate("relations",D).
violation("core.shape-ids-unique",D,"hard") :- duplicate("shapes",D).
violation("core.thing-template-definitions-unique",D,"hard") :- duplicate("thingTemplates",D).
violation("core.rule-packs-pinned",D,"hard") :- duplicate("rulePacks",D).
violation("core.completeness-declarations-unique",S,"hard") :- duplicate("completeness",D), field(D,"key",S).

% Things and their templates.
violation("core.thing-references-pinned",T,"hard") :- node(T,"ws.thing",_), not hasField(T,"revisionId").
violation("core.thing-references-pinned",T,"hard") :- node(T,"ws.thing",_), not hasField(T,"templateId").
violation("core.thing-references-pinned",T,"hard") :- node(T,"ws.thing",_), not hasField(T,"templateVersion").
violation("core.thing-template-resolves",T,"hard") :- node(T,"ws.thing",_), link(T,"ws.usesTemplate",TT,_), not known(TT).
resolvedTemplate(T,TT) :- node(T,"ws.thing",_), link(T,"ws.usesTemplate",TT,_), node(TT,"ws.thingTemplate",_).
compatibleWith(TT,W) :- node(TT,"ws.thingTemplate",_), field(TT,"compatibleWorldTemplates",W).
violation("core.thing-template-compatible",T,"hard") :- resolvedTemplate(T,TT), snapshotField("templateRef",W), not compatibleWith(TT,W).
violation("core.thing-template-inherits-context",T,"hard") :- resolvedTemplate(T,TT), field(TT,"inheritsWorldContext","false").
violation("core.thing-template-capabilities",T,"hard") :- resolvedTemplate(T,TT), field(T,"external",A), field(TT,"external",B), A != B.
violation("core.thing-template-capabilities",T,"hard") :- resolvedTemplate(T,TT), field(T,"forkable",A), field(TT,"forkable",B), A != B.
violation("core.thing-template-capabilities",T,"hard") :- resolvedTemplate(T,TT), field(T,"observable",A), field(TT,"observable",B), A != B.
violation("core.thing-template-capabilities",T,"hard") :- resolvedTemplate(T,TT), field(T,"reversible",A), field(TT,"reversible",B), A != B.

% World pins.
violation("core.world-references-pinned",W,"hard") :- worldId(W), node(S,"ws.snapshot",_), not hasField(S,"revisionId").
violation("core.world-references-pinned",W,"hard") :- worldId(W), node(S,"ws.snapshot",_), not hasField(S,"templateId").
violation("core.world-references-pinned",W,"hard") :- worldId(W), node(S,"ws.snapshot",_), not hasField(S,"templateVersion").

% Rule packs: pins, the compiled catalogue, and what the World Template and the catalogue require.
violation("core.rule-packs-pinned",P,"hard") :- node(P,"ws.rulePack",_), not hasField(P,"id").
violation("core.rule-packs-pinned",P,"hard") :- node(P,"ws.rulePack",_), not hasField(P,"version").
compiledPin(X) :- node(C,"ws.compiledPack",_), field(C,"pin",X).
pinned(X) :- node(P,"ws.rulePack",_), field(P,"pin",X).
violation("core.compiled-rule-packs",P,"hard") :- node(P,"ws.rulePack",_), field(P,"pin",X), not compiledPin(X).
violation("core.compiled-rule-packs",R,"hard") :- node(R,"ws.requiredPack",_), field(R,"pin",X), not compiledPin(X).
requiredPin(X) :- node(R,"ws.requiredPack",_), field(R,"pin",X).
requiredPin(X) :- node(C,"ws.compiledPack",_), field(C,"requiredFor","*"), field(C,"pin",X).
requiredPin(X) :- node(C,"ws.compiledPack",_), field(C,"requiredFor",T), snapshotField("templateId",T), field(C,"pin",X).
violation("core.required-rule-packs",X,"hard") :- requiredPin(X), not pinned(X).

% References. Typed references come from the purpose, the environment and theory claims.
violation("core.references-resolve",F,"hard") :- link(F,R,_,_), not known(F), R != "ws.ofThing".
violation("core.references-resolve",T,"hard") :- link(F,R,T,_), known(F), not known(T), R != "ws.ofThing", R != "ws.usesTemplate".
violation("core.references-resolve",N,"hard") :- link(N,"ws.ofThing",T,_), not known(T).
violation("core.references-resolve",N,"hard") :- node(N,_,P), P != "", not known(P).
violation("core.typed-references",T,"hard") :- link(_,"ws.purposeBeneficiary",T,_), node(T,K,_), K != "beneficiary".
violation("core.typed-references",T,"hard") :- link(_,"ws.purposeOutcome",T,_), node(T,K,_), K != "outcome".
violation("core.typed-references",T,"hard") :- link(_,"ws.environmentModel",T,_), node(T,K,_), K != "environment".
violation("core.typed-references",T,"hard") :- link(_,"ws.claimOutcome",T,_), node(T,K,_), K != "outcome".
violation("core.typed-references",T,"hard") :- link(_,"ws.claimIndicator",T,_), node(T,K,_), K != "indicator".
violation("core.typed-references",T,"hard") :- link(_,"ws.claimEvaluation",T,_), node(T,K,_), K != "evaluationPlan".

% Shapes: required properties are blockers in world-core, not just missing.
violation("core.shape-required-properties",N,"hard") :- node(N,K,_), requiredField(K,F), not hasField(N,F).

% Endpoint legality is per declared pair, so kinds from two endpoint entries of one relation do not mix.
objectLink(F,R,T) :- link(F,R,T,_), node(F,FK,_), FK != "ws.purpose", FK != "ws.environment", FK != "ws.claim", FK != "ws.thing", R != "ws.ofThing".
endpointLegal(F,R,T) :- objectLink(F,R,T), node(F,FK,_), node(T,TK,_), node(E,"ws.endpoint",_), field(E,"relationKind",R), field(E,"fromKinds",FK), field(E,"toKinds",TK).
violation("core.relation-endpoints-legal",F,"hard") :- objectLink(F,R,T), known(T), not endpointLegal(F,R,T).

% Required relations: a blocker when the scope is declared complete exactly once, otherwise unknown.
dupScope(S) :- duplicate("completeness",D), field(D,"key",S).
scopeComplete(S) :- declared(S,"complete"), not dupScope(S).
reqSatisfied(Q,X) :- node(Q,"ws.requirement",_), field(Q,"subjectKind",SK), field(Q,"relationKind",RK), field(Q,"objectKind",OK), node(X,SK,_), link(X,RK,T,_), node(T,OK,_).
reqOpen(Q,Rule,X,S) :- node(Q,"ws.requirement",_), field(Q,"ruleId",Rule), field(Q,"subjectKind",SK), field(Q,"scope",S), node(X,SK,_), not reqSatisfied(Q,X).
violation(Rule,X,"hard") :- reqOpen(_,Rule,X,S), scopeComplete(S).
missing(Rule,X) :- reqOpen(_,Rule,X,S), not scopeComplete(S).

% Forbidden cycles and incompatible constraints under their own rule ids (core reports them under one id).
cyclePath(C,X,Y) :- forbiddenCycle(C,R), link(X,R,Y,_).
cyclePath(C,X,Z) :- cyclePath(C,X,Y), forbiddenCycle(C,R), link(Y,R,Z,_).
violation(C,X,"hard") :- cyclePath(C,X,X).
incompatibleHit(C,N,F) :- incompatible(C,K,F,V), node(N,K,_), field(N,F,V).
violation(C,N,"hard") :- incompatibleHit(C,N,_), incompatibleSize(C,S), H = count : incompatibleHit(C,N,_), H = S.
` };
