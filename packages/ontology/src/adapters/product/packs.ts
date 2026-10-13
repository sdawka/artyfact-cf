/** Template packs for `template.meta.product-spec@1`: only what the meta@1 constraint vocabulary cannot say. */

export const productNeeds = { id: "product.needs", version: "1", source: `
% product.needs@1 - kind needs (lfp KindDef.needs) whose relation reaches more kinds than the one the need produces,
% or that point inward at a relation with several target kinds. requiredRel and relCard cannot filter by the other end's kind.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl met(Rule: sym, Node: sym)
.decl obligation(Rule: sym, Subject: sym) .output
.decl missing(Rule: sym, Subject: sym) .output

.message "need.hypothesisMetric" "Bet {1} references no metric: how would you know it holds?"
.message "need.moduleInterface" "Module {1} exposes no interface."
.message "need.protocolPractice" "Protocol {1} is not realised by any practice."

% One rule per need, written out rather than read from a fact table, so every derivation bottoms out in EDB facts.
met("need.hypothesisMetric",N) :- node(N,"hypothesis",_), link(N,"references",O,_), node(O,"metric",_).
met("need.moduleInterface",N) :- node(N,"module",_), link(N,"exposes",O,_), node(O,"interface",_).
met("need.protocolPractice",N) :- node(N,"protocol",_), link(O,"realises",N,_), node(O,"practice",_).

obligation("need.hypothesisMetric",N) :- node(N,"hypothesis",_).
obligation("need.moduleInterface",N) :- node(N,"module",_).
obligation("need.protocolPractice",N) :- node(N,"protocol",_).
missing("need.hypothesisMetric",N) :- node(N,"hypothesis",_), not met("need.hypothesisMetric",N).
missing("need.moduleInterface",N) :- node(N,"module",_), not met("need.moduleInterface",N).
missing("need.protocolPractice",N) :- node(N,"protocol",_), not met("need.protocolPractice",N).
` };

export const productChecks = { id: "product.checks", version: "1", source: `
% product.checks@1 - the code-decided checks of uip CHECKS-SPEC and lfp INVARIANTS that are not cardinalities,
% plus the semantic candidate for outcomes no metric monitors.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl reached(Audience: sym)
.decl monitored(Outcome: sym)
.decl hasFlow(Feature: sym)
.decl targeted(Test: sym)
.decl obligation(Rule: sym, Subject: sym) .output
.decl missing(Rule: sym, Subject: sym) .output
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl warning(Rule: sym, Subject: sym) .output
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output

.message "audience.unreached" "Audience {1} is served by no feature or capability and has no flow."
.message "node.proposed" "Node {1} is not committed yet."
.message "edge.selfLoop" "Node {1} links to itself."
.message "evidence.verdictMismatch" "Evidence {1} records a verdict its edge type contradicts."
.message "feature.stagesWithoutFlow" "Feature {1} claims lifecycle stages but has no flow."
.message "result.untargeted" "Test result {1} is not passing and no task targets its test."

reached(A) :- node(A,"audience",_), link(_,"serves",A,_).
reached(A) :- node(A,"audience",_), link(A,"has",X,_), node(X,"flow",_).
obligation("audience.unreached",A) :- node(A,"audience",_).
missing("audience.unreached",A) :- node(A,"audience",_), not reached(A).

monitored(O) :- link(M,"monitors",O,_), node(M,"metric",_).
semanticCandidate("outcome.measurable",O,T) :- node(O,"outcome",_), not monitored(O), field(O,"title",T).

warning("node.proposed",N) :- field(N,"status",S), S != "committed".
violation("edge.selfLoop",X,"soft") :- link(X,_,X,_).
violation("evidence.verdictMismatch",E,"hard") :- node(E,"evidence",_), field(E,"props.verdict","supports"), link(E,"refutes",_,_).
violation("evidence.verdictMismatch",E,"hard") :- node(E,"evidence",_), field(E,"props.verdict","refutes"), link(E,"supports",_,_).

hasFlow(F) :- link(F,"has",X,_), node(X,"flow",_).
hasFlow(F) :- link(X,"implements",F,_), node(X,"flow",_).
warning("feature.stagesWithoutFlow",F) :- node(F,"feature",_), field(F,"props.stages",_), not hasFlow(F).

targeted(T) :- link(_,"targets",T,_).
warning("result.untargeted",R) :- node(R,"test-result",_), field(R,"props.status",S), S != "pass", link(R,"reports",T,_), not targeted(T).
` };

export const spacesChecks = { id: "spaces.checks", version: "1", source: `
% spaces.checks@1 - code alignment as findings: broken code is a soft violation, roadmap-only nodes are advisory.

.decl field(Node: sym, Field: sym, Value: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "alignment.broken" "Node {1} is broken in the code relative to its stated truth."
.message "alignment.roadmap" "Node {1} exists only on the roadmap."

violation("alignment.broken",N,"soft") :- field(N,"codeAlignment","broken").
violation("alignment.roadmap",N,"advisory") :- field(N,"codeAlignment","roadmap").
` };
