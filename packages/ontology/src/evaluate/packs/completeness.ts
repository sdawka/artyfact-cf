export const completeness = { id: "completeness", version: "1", source: `
% completeness@1 - what a partially filled graph still lacks. Every check derives an obligation; unmet ones are missing.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl parent(Child: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl declared(Scope: sym, Status: sym)
.decl provisional(Id: sym)
.decl kindParent(Kind: sym, Parent: sym)
.decl requiredField(Kind: sym, Field: sym)
.decl requiredChild(Kind: sym, Child: sym, Min: num, Max: num)
.decl requiredRel(Kind: sym, Rel: sym, Min: num, Max: num)
.decl relEndpoint(Rel: sym, Side: sym, Kind: sym)
.decl relCard(Rel: sym, Dir: sym, Min: num, Max: num)
.decl exactlyOne(Id: sym, Kind: sym, MemberType: sym, Member: sym)
.decl completeScope(Id: sym, Kind: sym)
.decl hasField(Node: sym, Field: sym)
.decl childOfKind(Parent: sym, Kind: sym, Child: sym)
.decl outEdge(From: sym, Rel: sym, To: sym)
.decl inEdge(To: sym, Rel: sym, From: sym)
.decl rootOnlyBarred(Kind: sym)
.decl oneOfHit(Id: sym, Node: sym)
.decl obligation(Rule: sym, Subject: sym) .output
.decl missing(Rule: sym, Subject: sym) .output

.message "field.required" "Node {1} lacks a field its kind requires."
.message "children.required" "Node {1} has fewer children of a required kind than its template asks for."
.message "relation.required" "Node {1} has fewer links of a required relation than its kind asks for."
.message "relation.minOut" "Node {1} has fewer outgoing links than the relation's cardinality requires."
.message "relation.minIn" "Node {1} has fewer incoming links than the relation's cardinality requires."
.message "tree.parentRequired" "Node {1} has no parent, but its kind must be contained."
.message "scope.undeclared" "Scope {1} is not declared complete."
.message "node.provisional" "Node {1} is still provisional."
.message "exactlyOne.none" "Node {1} has none of a group it must have exactly one of."

hasField(N,F) :- field(N,F,_).
childOfKind(P,K,C) :- parent(C,P), node(C,K,_).
outEdge(F,R,T) :- link(F,R,T,_).
inEdge(T,R,F) :- link(F,R,T,_).
rootOnlyBarred(K) :- kindParent(K,_).
oneOfHit(C,N) :- exactlyOne(C,K,"field",F), node(N,K,_), field(N,F,_).
oneOfHit(C,N) :- exactlyOne(C,K,"rel",R), node(N,K,_), outEdge(N,R,_).

obligation("field.required",N) :- node(N,K,_), requiredField(K,_).
missing("field.required",N) :- node(N,K,_), requiredField(K,F), not hasField(N,F).

obligation("children.required",P) :- node(P,K,_), requiredChild(K,_,Min,_), Min > 0.
missing("children.required",P) :- node(P,K,_), requiredChild(K,CK,Min,_), Min > 0, N = count : childOfKind(P,CK,_), N < Min.

obligation("relation.required",X) :- node(X,K,_), requiredRel(K,_,Min,_), Min > 0.
missing("relation.required",X) :- node(X,K,_), requiredRel(K,R,Min,_), Min > 0, N = count : outEdge(X,R,_), N < Min.

obligation("relation.minOut",X) :- relCard(R,"out",Min,_), Min > 0, relEndpoint(R,"from",K), node(X,K,_).
missing("relation.minOut",X) :- relCard(R,"out",Min,_), Min > 0, relEndpoint(R,"from",K), node(X,K,_), N = count : outEdge(X,R,_), N < Min.
obligation("relation.minIn",X) :- relCard(R,"in",Min,_), Min > 0, relEndpoint(R,"to",K), node(X,K,_).
missing("relation.minIn",X) :- relCard(R,"in",Min,_), Min > 0, relEndpoint(R,"to",K), node(X,K,_), N = count : inEdge(X,R,_), N < Min.

obligation("tree.parentRequired",N) :- node(N,K,_), rootOnlyBarred(K).
missing("tree.parentRequired",N) :- node(N,K,""), rootOnlyBarred(K).

obligation("scope.undeclared",N) :- completeScope(_,K), node(N,K,_).
missing("scope.undeclared",N) :- completeScope(_,K), node(N,K,_), not declared(N,"complete").

obligation("node.provisional",N) :- provisional(N).
missing("node.provisional",N) :- provisional(N).

obligation("exactlyOne.none",N) :- exactlyOne(_,K,_,_), node(N,K,_).
missing("exactlyOne.none",N) :- exactlyOne(C,K,_,_), node(N,K,_), not oneOfHit(C,N).
` };
