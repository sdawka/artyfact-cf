export const consistency = { id: "consistency", version: "1", source: `
% consistency@1 - declarations in the graph that contradict the template or each other.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl parent(Child: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl requiredChild(Kind: sym, Child: sym, Min: num, Max: num)
.decl requiredRel(Kind: sym, Rel: sym, Min: num, Max: num)
.decl relCard(Rel: sym, Dir: sym, Min: num, Max: num)
.decl relAcyclic(Rel: sym)
.decl forbiddenCycle(Id: sym, Rel: sym)
.decl incompatible(Id: sym, Kind: sym, Field: sym, Value: sym)
.decl incompatibleSize(Id: sym, Size: num)
.decl exclusive(Id: sym, Rel: sym)
.decl exactlyOne(Id: sym, Kind: sym, MemberType: sym, Member: sym)
.decl edge(From: sym, Rel: sym, To: sym)
.decl backEdge(To: sym, Rel: sym, From: sym)
.decl kid(Parent: sym, Kind: sym, Child: sym)
.decl relPath(Rel: sym, X: sym, Y: sym)
.decl cyclePath(Id: sym, X: sym, Y: sym)
.decl incompatibleHit(Id: sym, Node: sym, Field: sym)
.decl memberHit(Id: sym, Node: sym, Member: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "relation.maxOut" "Node {1} has more outgoing links than the relation's cardinality allows."
.message "relation.maxIn" "Node {1} has more incoming links than the relation's cardinality allows."
.message "relation.requiredMax" "Node {1} has more links of a relation than its kind allows."
.message "children.max" "Node {1} has more children of a kind than its template allows."
.message "relation.cycle" "Node {1} is on a cycle of an acyclic relation."
.message "cycle.forbidden" "Node {1} is on a forbidden cycle."
.message "constraint.incompatible" "Node {1} combines field values the template declares incompatible."
.message "relation.exclusive" "Node {1} links to the same target through mutually exclusive relations."
.message "exactlyOne.many" "Node {1} has more than one member of a group it must have exactly one of."
.message "certainty.contradiction" "Node {1} has an observed link that contradicts a declared one on a single-valued relation."

edge(F,R,T) :- link(F,R,T,_).
backEdge(T,R,F) :- link(F,R,T,_).
kid(P,K,C) :- parent(C,P), node(C,K,_).

violation("relation.maxOut",X,"hard") :- relCard(R,"out",_,Max), Max >= 0, edge(X,R,_), N = count : edge(X,R,_), N > Max.
violation("relation.maxIn",X,"hard") :- relCard(R,"in",_,Max), Max >= 0, backEdge(X,R,_), N = count : backEdge(X,R,_), N > Max.
violation("relation.requiredMax",X,"hard") :- requiredRel(K,R,_,Max), Max >= 0, node(X,K,_), N = count : edge(X,R,_), N > Max.
violation("children.max",P,"hard") :- requiredChild(K,CK,_,Max), Max >= 0, node(P,K,_), N = count : kid(P,CK,_), N > Max.

relPath(R,X,Y) :- relAcyclic(R), edge(X,R,Y).
relPath(R,X,Z) :- relPath(R,X,Y), edge(Y,R,Z).
violation("relation.cycle",X,"hard") :- relPath(_,X,X).

cyclePath(C,X,Y) :- forbiddenCycle(C,R), edge(X,R,Y).
cyclePath(C,X,Z) :- cyclePath(C,X,Y), forbiddenCycle(C,R), edge(Y,R,Z).
violation("cycle.forbidden",X,"hard") :- cyclePath(_,X,X).

incompatibleHit(C,N,F) :- incompatible(C,K,F,V), node(N,K,_), field(N,F,V).
violation("constraint.incompatible",N,"hard") :- incompatibleHit(C,N,_), incompatibleSize(C,S), H = count : incompatibleHit(C,N,_), H = S.

violation("relation.exclusive",F,"hard") :- exclusive(C,R1), exclusive(C,R2), R1 != R2, edge(F,R1,T), edge(F,R2,T).

memberHit(C,N,F) :- exactlyOne(C,K,"field",F), node(N,K,_), field(N,F,_).
memberHit(C,N,R) :- exactlyOne(C,K,"rel",R), node(N,K,_), edge(N,R,_).
violation("exactlyOne.many",N,"hard") :- memberHit(C,N,_), H = count : memberHit(C,N,_), H > 1.

violation("certainty.contradiction",F,"hard") :- relCard(R,"out",_,1), link(F,R,T1,"declared"), link(F,R,T2,"observed"), T1 != T2.
` };
