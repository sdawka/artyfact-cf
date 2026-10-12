export type { Value, Tuple, ColumnType, Decl, Term, Atom, CmpOp, Literal, Rule, Program, Stratum } from "./types";
export { RuleParseError, StratificationError } from "./types";
export type { FactSet, RunOptions, Derivation, Result } from "./engine";
export { factSet, run, render } from "./engine";
export type { DerivationTree } from "./explain";
export { explain } from "./explain";
export { parse } from "./parse";
export { stratify } from "./stratify";
