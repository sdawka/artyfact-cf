export const meta = { id: "meta", version: "1", source: `
% meta@1 - form validity of a template: is it a coherent ontology whose constraints can be satisfied?

.decl templateRef(Ref: sym)
.decl kind(Kind: sym)
.decl kindField(Kind: sym, Field: sym, Type: sym, Required: bool)
.decl kindParent(Kind: sym, Parent: sym)
.decl requiredField(Kind: sym, Field: sym)
.decl requiredChild(Kind: sym, Child: sym, Min: num, Max: num)
.decl requiredRel(Kind: sym, Rel: sym, Min: num, Max: num)
.decl relation(Rel: sym)
.decl relEndpoint(Rel: sym, Side: sym, Kind: sym)
.decl relInverse(Rel: sym, Inverse: sym)
.decl forbiddenCycle(Id: sym, Rel: sym)
.decl incompatible(Id: sym, Kind: sym, Field: sym, Value: sym)
.decl exclusive(Id: sym, Rel: sym)
.decl exactlyOne(Id: sym, Kind: sym, MemberType: sym, Member: sym)
.decl completeScope(Id: sym, Kind: sym)
.decl criterion(Id: sym, Owner: sym, Subject: sym, Severity: sym)
.decl extends(From: sym, To: sym)
.decl templateKnown(Ref: sym)
.decl templateNode(Id: sym, Kind: sym)
.decl templateNodeLink(Id: sym, Rel: sym)
.decl packError(Pack: sym, Kind: sym, Detail: sym)
.decl packRead(Key: sym, Pack: sym, Rel: sym)
.decl packDerives(Rel: sym)
.decl edbRelation(Rel: sym)
.decl questionPolicy(Question: sym, Answer: sym, Level: sym)
.decl questionSliceKind(Question: sym, Kind: sym)
.decl questionSliceRel(Question: sym, Rel: sym)
.decl question(Id: sym, Answer: sym)
.decl questionNext(Question: sym, Ask: sym)
.decl questionOwnDefect(Question: sym, Defect: sym)
.decl questionPolicyDefect(Question: sym, Answer: sym, Defect: sym)
.decl questionNextCycle(Question: sym)
.decl questionBatch(Question: sym, With: sym)
.decl questionByKind(Question: sym, Kind: sym)
.decl questionPassFrom(Question: sym, Kind: sym)
.decl questionChoice(Question: sym, Choice: sym)
.decl questionCriterionKey(Question: sym, Choice: sym)
.decl questionOption(Question: sym, Choice: sym)
.decl questionBenignInvalid(Question: sym)
.decl questionPolicyAnswer(Question: sym, Answer: sym)
.decl defectKnown(Id: sym)
.decl defectDisable(Id: sym)
.decl defectLevelDecl(Id: sym, Level: sym)
.decl findingLevel(Level: sym)
.decl textBound(Scope: sym, Field: sym, Key: sym, N: num)
.decl textPatternInvalid(Scope: sym, Field: sym)
.decl textDistinctDecl(Scope: sym, Field: sym, Other: sym)
.decl textDefaultDistinct(Scope: sym, Other: sym)
.decl criterionMinScore(Kind: sym, N: num)
.decl criterionTooLong(Scope: sym, Key: sym)
.decl checkIdDuplicate(Rule: sym)
.decl checkDefect(Rule: sym, Defect: sym)
.decl checkWhenField(Rule: sym, Kind: sym, Field: sym)
.decl checkPatternInvalid(Rule: sym)
.decl checkLevelUnknown(Rule: sym, Level: sym)
.decl fieldDeclared(Kind: sym, Field: sym)
.decl fieldDeclaredAnywhere(Field: sym)
.decl parentConstrained(Kind: sym)
.decl extendsReach(X: sym, Y: sym)
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "relation.endpointUnknown" "Relation {1} names an endpoint kind the template does not declare."
.message "relation.inverseUnknown" "Relation {1} names an inverse relation the template does not declare."
.message "kind.parentUnknown" "Kind {1} allows a parent kind the template does not declare."
.message "kind.fieldUnknown" "Kind {1} requires a field it does not declare."
.message "kind.childUnknown" "Kind {1} requires children of a kind the template does not declare."
.message "kind.childUnsatisfiable" "Kind {1} requires children of a kind that may not be contained in it."
.message "kind.relationUnknown" "Kind {1} requires a relation the template does not declare."
.message "kind.relationUnsatisfiable" "Kind {1} requires a relation whose vocabulary does not allow it as a source."
.message "constraint.relationUnknown" "Constraint {1} names a relation the template does not declare."
.message "constraint.kindUnknown" "Constraint {1} names a kind the template does not declare."
.message "constraint.fieldUnknown" "Constraint {1} names a field its kind does not declare."
.message "template.extendsUnknown" "Template {1} extends a template that cannot be resolved."
.message "template.extendsCycle" "Template {1} is part of an extends cycle."
.message "rules.parse" "Rule pack {1} does not parse."
.message "rules.stratify" "Rule pack {1} does not stratify."
.message "rules.unknownRelation" "Rule pack read {1} names a relation that is neither emitted by the engine nor derived by the template."
.message "criterion.subjectKindUnknown" "Criterion {1} subjects a kind the template does not declare."
.message "question.levelUnknown" "Question {1} maps an answer to an unknown finding level."
.message "question.sliceKindUnknown" "Question {1} slices a kind the template does not declare."
.message "question.sliceRelationUnknown" "Question {1} slices along a relation the template does not declare."
.message "question.defectUnknown" "Question {1} names a defect that defects@1 does not define."
.message "policy.defectUnknown" "Question {1} maps an answer to a defect that defects@1 does not define."
.message "question.nextUnknown" "Question {1} follows up with a question the template does not declare."
.message "question.nextCycle" "Question {1} is part of a follow-up cycle."
.message "question.batchUnknown" "Question {1} batches with a question the template does not declare."
.message "question.byKindUnknown" "Question {1} words a kind the template does not declare."
.message "question.passFromUnknown" "Question {1} sets a pass boundary for a kind the template does not declare."
.message "question.criterionUnknown" "Question {1} gives a criterion for an option it does not declare."
.message "question.choiceUnmapped" "Question {1} declares an option its policy does not map, so that answer stays unknown."
.message "question.benignInvalid" "Question {1} has a benign answer it cannot give."
.message "defect.disableUnknown" "Defect {1} is disabled but defects@1 does not define it."
.message "defect.levelUnknown" "Defect {1} has a level override but defects@1 does not define it."
.message "node.kindUnknown" "Prefilled node {1} has a kind the template does not declare."
.message "node.relationUnknown" "Prefilled node {1} has a link whose relation the template does not declare."
.message "kind.textBoundNegative" "Kind {1} declares a negative minimum length or word count on a field."
.message "kind.textPatternInvalid" "Kind {1} declares a field pattern that is not a valid regular expression."
.message "kind.textDistinctUnknown" "Kind {1} declares a field distinct from a field it does not declare."
.message "kind.textDistinctSelf" "Kind {1} declares a field distinct from itself."
.message "template.textBoundNegative" "Template {1} declares a negative minimum length or word count in textDefaults."
.message "template.textPatternInvalid" "Template {1} declares a textDefaults pattern that is not a valid regular expression."
.message "criteria.minScoreRange" "Kind {1} sets a minimum tangibility score outside 0 to 4."
.message "criteria.tooLong" "{1} states a criterion longer than 255 characters; questions cut it."
.message "check.idDuplicate" "Check {1} is declared twice for the same kind."
.message "check.defectUnknown" "Check {1} stands for a defect that defects@1 does not define."
.message "check.whenFieldUnknown" "Check {1} applies when a field is set that its kind does not declare."
.message "check.patternInvalid" "Check {1} declares a pattern that is not a valid regular expression."
.message "check.levelUnknown" "Check {1} declares a level other than error, warning or info."
.message "template.textDistinctUnknown" "Template {1} declares textDefaults distinct from a field no kind declares."

fieldDeclared(K,F) :- kindField(K,F,_,_).
parentConstrained(K) :- kindParent(K,_).
fieldDeclaredAnywhere(F) :- kindField(_,F,_,_).
extendsReach(X,Y) :- extends(X,Y).
extendsReach(X,Z) :- extends(X,Y), extendsReach(Y,Z).

violation("relation.endpointUnknown",R,"hard") :- relEndpoint(R,_,K), not kind(K).
violation("relation.inverseUnknown",R,"hard") :- relInverse(R,I), not relation(I).
violation("kind.parentUnknown",K,"hard") :- kindParent(K,P), not kind(P).
violation("kind.fieldUnknown",K,"hard") :- requiredField(K,F), not fieldDeclared(K,F).
violation("kind.childUnknown",K,"hard") :- requiredChild(K,C,_,_), not kind(C).
violation("kind.childUnsatisfiable",K,"hard") :- requiredChild(K,C,Min,_), Min > 0, parentConstrained(C), not kindParent(C,K).
violation("kind.relationUnknown",K,"hard") :- requiredRel(K,R,_,_), not relation(R).
violation("kind.relationUnsatisfiable",K,"hard") :- requiredRel(K,R,Min,_), Min > 0, relation(R), not relEndpoint(R,"from",K).

violation("constraint.relationUnknown",C,"hard") :- forbiddenCycle(C,R), not relation(R).
violation("constraint.relationUnknown",C,"hard") :- exclusive(C,R), not relation(R).
violation("constraint.relationUnknown",C,"hard") :- exactlyOne(C,_,"rel",R), not relation(R).
violation("constraint.kindUnknown",C,"hard") :- incompatible(C,K,_,_), not kind(K).
violation("constraint.kindUnknown",C,"hard") :- exactlyOne(C,K,_,_), not kind(K).
violation("constraint.kindUnknown",C,"hard") :- completeScope(C,K), not kind(K).
violation("constraint.fieldUnknown",C,"hard") :- incompatible(C,K,F,_), kind(K), not fieldDeclared(K,F).
violation("constraint.fieldUnknown",C,"hard") :- exactlyOne(C,K,"field",F), kind(K), not fieldDeclared(K,F).

violation("template.extendsUnknown",T,"hard") :- extends(T,P), not templateKnown(P).
violation("template.extendsCycle",T,"hard") :- extendsReach(T,T).

violation("rules.parse",P,"hard") :- packError(P,"parse",_).
violation("rules.stratify",P,"hard") :- packError(P,"stratify",_).
violation("rules.unknownRelation",Key,"hard") :- packRead(Key,_,R), not edbRelation(R), not packDerives(R).

violation("criterion.subjectKindUnknown",C,"hard") :- criterion(C,_,K,_), not kind(K).
violation("question.levelUnknown",Q,"hard") :- questionPolicy(Q,_,L), not findingLevel(L).
violation("question.sliceKindUnknown",Q,"hard") :- questionSliceKind(Q,K), not kind(K).
violation("question.sliceRelationUnknown",Q,"hard") :- questionSliceRel(Q,R), not relation(R).
violation("question.defectUnknown",Q,"hard") :- questionOwnDefect(Q,D), not defectKnown(D).
violation("policy.defectUnknown",Q,"hard") :- questionPolicyDefect(Q,_,D), not defectKnown(D).
violation("question.nextUnknown",Q,"hard") :- questionNext(Q,A), not question(A,_).
violation("question.nextCycle",Q,"hard") :- questionNextCycle(Q).
violation("question.batchUnknown",Q,"hard") :- questionBatch(Q,B), not question(B,_).
violation("question.byKindUnknown",Q,"hard") :- questionByKind(Q,K), not kind(K).
violation("question.passFromUnknown",Q,"hard") :- questionPassFrom(Q,K), not kind(K).
violation("question.criterionUnknown",Q,"hard") :- questionCriterionKey(Q,C), not questionChoice(Q,C).
questionPolicyAnswer(Q,A) :- questionPolicy(Q,A,_).
violation("question.choiceUnmapped",Q,"soft") :- questionOption(Q,C), not questionPolicyAnswer(Q,C), not questionPolicyAnswer(Q,"*").
violation("question.benignInvalid",Q,"hard") :- questionBenignInvalid(Q).
violation("defect.disableUnknown",D,"hard") :- defectDisable(D), not defectKnown(D).
violation("defect.levelUnknown",D,"hard") :- defectLevelDecl(D,_), not defectKnown(D).
violation("node.kindUnknown",N,"hard") :- templateNode(N,K), not kind(K).
violation("node.relationUnknown",N,"hard") :- templateNodeLink(N,R), not relation(R).

violation("kind.textBoundNegative",K,"hard") :- textBound(K,F,_,N), F != "*", N < 0.
violation("kind.textPatternInvalid",K,"hard") :- textPatternInvalid(K,F), F != "*".
violation("kind.textDistinctUnknown",K,"hard") :- textDistinctDecl(K,_,O), O != "id", not fieldDeclared(K,O).
violation("kind.textDistinctSelf",K,"hard") :- textDistinctDecl(K,F,F).
violation("template.textBoundNegative",T,"hard") :- textBound(T,"*",_,N), N < 0.
violation("template.textPatternInvalid",T,"hard") :- textPatternInvalid(T,"*").
violation("template.textDistinctUnknown",T,"hard") :- textDefaultDistinct(T,O), O != "id", not fieldDeclaredAnywhere(O).

violation("criteria.minScoreRange",K,"hard") :- criterionMinScore(K,N), N < 0.
violation("criteria.minScoreRange",K,"hard") :- criterionMinScore(K,N), N > 4.
violation("criteria.tooLong",S,"soft") :- criterionTooLong(S,_).

violation("check.idDuplicate",R,"hard") :- checkIdDuplicate(R).
violation("check.defectUnknown",R,"hard") :- checkDefect(R,D), not defectKnown(D).
violation("check.whenFieldUnknown",R,"hard") :- checkWhenField(R,K,F), K != "*", not fieldDeclared(K,F).
violation("check.whenFieldUnknown",R,"hard") :- checkWhenField(R,"*",F), not fieldDeclaredAnywhere(F).
violation("check.patternInvalid",R,"hard") :- checkPatternInvalid(R).
violation("check.levelUnknown",R,"hard") :- checkLevelUnknown(R,_).
` };
