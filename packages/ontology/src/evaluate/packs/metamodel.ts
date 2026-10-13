export const metamodel = { id: "metamodel", version: "1", source: `
% metamodel@1 - structural integrity of a graph against its template's vocabulary.

.decl graphTemplate(Ref: sym)
.decl templateRef(Ref: sym)
.decl node(Id: sym, Kind: sym, Parent: sym)
.decl known(Id: sym)
.decl ref(From: sym, Via: sym, To: sym)
.decl parent(Child: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl fieldType(Node: sym, Field: sym, Type: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl kind(Kind: sym)
.decl kindField(Kind: sym, Field: sym, Type: sym, Required: bool)
.decl kindFieldEnum(Kind: sym, Field: sym, Value: sym)
.decl kindParent(Kind: sym, Parent: sym)
.decl relation(Rel: sym)
.decl relEndpoint(Rel: sym, Side: sym, Kind: sym)
.decl typeAccepts(Type: sym, Observed: sym)
.decl reaches(X: sym, Y: sym)
.decl parentConstrained(Kind: sym)
.decl fieldDeclared(Kind: sym, Field: sym)
.decl fieldEnumerated(Kind: sym, Field: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.decl warning(Rule: sym, Subject: sym) .output

.message "graph.templateMismatch" "The graph names template {1}, which is not the template being evaluated."
.message "node.kindUnknown" "Node {1} has a kind the template does not declare."
.message "node.duplicate" "Node id {1} is used for more than one kind."
.message "ref.dangling" "{1} refers to an id that does not exist in the graph."
.message "ref.parentMissing" "{1} is contained in a parent that does not exist."
.message "tree.cycle" "{1} is part of a containment cycle."
.message "tree.multiParent" "{1} has more than one containment parent."
.message "tree.parentKind" "{1} is contained in a node whose kind its template does not allow as a parent."
.message "link.sourceUnknown" "A link starts at {1}, which does not exist in the graph."
.message "link.relationUnknown" "{1} has a link whose relation the template does not declare."
.message "link.endpoint" "{1} is an endpoint of a link whose relation does not allow its kind."
.message "field.type" "Node {1} has a field value of the wrong type."
.message "field.enum" "Node {1} has a field value outside the declared enum."
.message "field.unknown" "Node {1} has a field its kind does not declare."

reaches(X,Y) :- parent(X,Y).
reaches(X,Z) :- parent(X,Y), reaches(Y,Z).
parentConstrained(K) :- kindParent(K,_).
fieldDeclared(K,F) :- kindField(K,F,_,_).
fieldEnumerated(K,F) :- kindFieldEnum(K,F,_).

violation("graph.templateMismatch",R,"hard") :- graphTemplate(R), not templateRef(R).
violation("node.kindUnknown",N,"hard") :- node(N,K,_), not kind(K).
violation("node.duplicate",N,"hard") :- node(N,K1,_), node(N,K2,_), K1 != K2.
violation("ref.dangling",From,"hard") :- ref(From,_,To), not known(To).
violation("ref.parentMissing",C,"hard") :- parent(C,P), not known(P).
violation("tree.cycle",X,"hard") :- reaches(X,X).
violation("tree.multiParent",X,"hard") :- parent(X,P1), parent(X,P2), P1 != P2.
violation("tree.parentKind",C,"hard") :- parent(C,P), node(C,KC,_), node(P,KP,_), parentConstrained(KC), not kindParent(KC,KP).
violation("link.sourceUnknown",F,"hard") :- link(F,_,_,_), not known(F).
violation("link.relationUnknown",F,"hard") :- link(F,R,_,_), not relation(R).
violation("link.endpoint",F,"hard") :- link(F,R,_,_), relation(R), node(F,K,_), not relEndpoint(R,"from",K).
violation("link.endpoint",T,"hard") :- link(_,R,T,_), relation(R), node(T,K,_), not relEndpoint(R,"to",K).
violation("field.type",N,"hard") :- fieldType(N,F,O), node(N,K,_), kindField(K,F,T,_), not typeAccepts(T,O).
violation("field.enum",N,"hard") :- field(N,F,V), node(N,K,_), fieldEnumerated(K,F), not kindFieldEnum(K,F,V).
warning("field.unknown",N) :- fieldType(N,F,_), node(N,K,_), kind(K), not fieldDeclared(K,F).
` };
