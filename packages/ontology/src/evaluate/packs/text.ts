export const text = { id: "text", version: "1", source: `
% text@1 - deterministic text quality. Lengths, word counts, placeholder matches, sameness and pattern misses are
% computed by toFacts; these rules only join them with what the template declares.
%
% One blank field, one finding: an empty string is not emitted as a field, so field.required (completeness@1) owns it;
% a whitespace-only value is a field, so completeness is satisfied and text.empty owns it. Every other text rule
% requires a non-blank value, so a blank field never also reads as short, placeholder or same-as. A placeholder is the
% more specific diagnosis, so a field that is a placeholder ("TBD") is not also reported as short.

.decl node(Id: sym, Kind: sym, Parent: sym)
.decl requiredField(Kind: sym, Field: sym)
.decl fieldLen(Node: sym, Field: sym, Chars: num)
.decl fieldWords(Node: sym, Field: sym, Words: num)
.decl fieldPlaceholder(Node: sym, Field: sym, Token: sym)
.decl fieldSameAs(Node: sym, Field: sym, Other: sym)
.decl fieldPatternMiss(Node: sym, Field: sym)
.decl textMinLen(Kind: sym, Field: sym, N: num)
.decl textMinWords(Kind: sym, Field: sym, N: num)
.decl textDistinct(Kind: sym, Field: sym, Other: sym)
.decl textPattern(Kind: sym, Field: sym)
.decl filled(Node: sym, Field: sym)
.decl placeheld(Node: sym, Field: sym)
.decl missing(Rule: sym, Subject: sym) .output
.decl violation(Rule: sym, Subject: sym, Severity: sym) .output

.message "text.empty" "Node {1} has a required text field that is blank."
.message "text.short" "Node {1} has a text field shorter than its kind allows."
.message "text.placeholder" "Node {1} has a text field that is a placeholder."
.message "text.sameAsId" "Node {1} has a text field that only repeats its id."
.message "text.sameAsField" "Node {1} has a text field that only repeats another of its fields."
.message "text.pattern" "Node {1} has a text field that does not match its kind's pattern."

filled(N,F) :- fieldLen(N,F,L), L > 0.
placeheld(N,F) :- fieldPlaceholder(N,F,_).

missing("text.empty",N) :- node(N,K,_), requiredField(K,F), fieldLen(N,F,0).
missing("text.short",N) :- node(N,K,_), textMinLen(K,F,Min), fieldLen(N,F,L), L > 0, L < Min, not placeheld(N,F).
missing("text.short",N) :- node(N,K,_), textMinWords(K,F,Min), filled(N,F), fieldWords(N,F,W), W < Min, not placeheld(N,F).
missing("text.placeholder",N) :- fieldPlaceholder(N,F,_), filled(N,F).
violation("text.sameAsId",N,"soft") :- node(N,K,_), textDistinct(K,F,"id"), fieldSameAs(N,F,"id"), filled(N,F).
violation("text.sameAsField",N,"soft") :- node(N,K,_), textDistinct(K,F,O), O != "id", fieldSameAs(N,F,O), filled(N,F).
violation("text.pattern",N,"hard") :- node(N,K,_), textPattern(K,F), fieldPatternMiss(N,F), filled(N,F).
` };
