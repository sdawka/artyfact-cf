export type { Value, Tuple, ColumnType, Decl, Term, Atom, CmpOp, Literal, Rule, Program, Stratum } from "./types.ts";
export { RuleParseError, StratificationError } from "./types.ts";
export type { FactSet, RunOptions, Derivation, Result } from "./engine.ts";
export { factSet, run, render } from "./engine.ts";
export type { DerivationTree } from "./explain.ts";
export { explain } from "./explain.ts";
export { parse } from "./parse.ts";
export { stratify } from "./stratify.ts";
