export type Value = string | number | boolean;
export type Tuple = Value[];
export type ColumnType = "sym" | "num" | "bool";

export interface Decl { name: string; arity: number; columns: { name: string; type: ColumnType }[]; output: boolean; line: number }

export type Term = { kind: "var"; name: string } | { kind: "const"; value: Value } | { kind: "wild" };
export interface Atom { rel: string; args: Term[]; line: number; column: number }
export type CmpOp = "=" | "!=" | "<" | "<=" | ">" | ">=";
export type Literal =
  | ({ kind: "atom"; negated: boolean } & Atom)
  | { kind: "cmp"; op: CmpOp; left: Term; right: Term; line: number; column: number }
  | { kind: "builtin"; name: "contains" | "matches"; args: Term[]; negated: boolean; line: number; column: number }
  | { kind: "count"; result: string; atom: Atom; line: number; column: number };

export interface Rule { id: string; program: string; line: number; head: Atom; body: Literal[] }

export interface Program {
  name: string;
  decls: Map<string, Decl>;
  rules: Rule[];
  messages: Map<string, string>;
}

export interface Stratum { relations: string[]; rules: Rule[] }

export class RuleParseError extends Error {
  file: string;
  line: number;
  column: number;
  constructor(file: string, line: number, column: number, detail: string) {
    super(`${file}:${line}:${column}: ${detail}`);
    this.name = "RuleParseError";
    this.file = file; this.line = line; this.column = column;
  }
}

export class StratificationError extends Error {
  cycle: string[];
  constructor(cycle: string[], detail: string) {
    super(detail);
    this.name = "StratificationError";
    this.cycle = cycle;
  }
}

export const keyOf = (v: Value): string => JSON.stringify(v);
