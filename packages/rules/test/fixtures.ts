export const TREE_DECLS = `
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl parent(Child: sym, Parent: sym)
.decl ancestor(X: sym, Y: sym) .output
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
`;

export const TREE_RULES = `${TREE_DECLS}
ancestor(X,Z) :- parent(X,Z).
ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).
violation("tree.cycle",X,"hard") :- ancestor(X,X).
violation("tree.multiParent",C,"hard") :- parent(C,P1), parent(C,P2), P1 != P2.
`;

export const AUTHZ = `
% authorization@1 subset (plan, packages/rules section)
.decl node(Id: sym, Kind: sym, Thing: sym)
.decl parent(Child: sym, Parent: sym)
.decl link(From: sym, Rel: sym, To: sym, Certainty: sym)
.decl ancestor(X: sym, Y: sym)
.decl governedBy(N: sym, P: sym) .output
.decl mutating(Op: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output
.message "authz.ungoverned" "Operation {1} writes data but no authorization policy governs it."
ancestor(X,Z) :- parent(X,Z).
ancestor(X,Z) :- parent(X,Y), ancestor(Y,Z).
governedBy(N,P) :- link(N,"governs",P,_).
governedBy(N,P) :- link(P,"governs",N,_).
governedBy(N,P) :- ancestor(N,A), governedBy(A,P).
governedBy(Op,P) :- link(Aff,"invokes",Op,_), governedBy(Aff,P).
mutating(Op) :- node(Op,"operation",_), link(Op,"writes",_,_).
violation("authz.ungoverned",Op,"hard") :- mutating(Op), not governedBy(Op,_).
`;
