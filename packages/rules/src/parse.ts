import { stratify } from "./stratify";
import {
  RuleParseError, type Atom, type CmpOp, type ColumnType, type Decl, type Literal, type Program, type Rule,
  type Term, type Value,
} from "./types";

type TokKind = "ident" | "var" | "string" | "number" | "directive" | "punct" | "eof";
interface Tok { kind: TokKind; text: string; value?: Value; line: number; column: number }

const PUNCT = [":-", "!=", "<=", ">=", "(", ")", ",", ".", ":", "=", "<", ">"];
const BUILTINS = new Set(["contains", "matches"]);
const TYPES = new Set(["sym", "num", "bool"]);

function lex(src: string, file: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0, line = 1, col = 1;
  const fail = (msg: string): never => { throw new RuleParseError(file, line, col, msg); };
  const advance = (n: number) => {
    for (let k = 0; k < n; k++, i++) {
      if (src[i] === "\n") { line++; col = 1; } else col++;
    }
  };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { advance(1); continue; }
    if (ch === "%") { while (i < src.length && src[i] !== "\n") advance(1); continue; }
    const start = { line, column: col };
    let m: RegExpExecArray | null;
    const at = (re: RegExp) => { re.lastIndex = i; return (m = re.exec(src)); };
    if (at(/\.[a-z]+/y)) {
      toks.push({ kind: "directive", text: m![0], ...start }); advance(m![0].length);
    } else if (at(/[a-z][A-Za-z0-9_]*/y)) {
      const t = m![0];
      if (t === "true" || t === "false") toks.push({ kind: "ident", text: t, value: t === "true", ...start });
      else toks.push({ kind: "ident", text: t, ...start });
      advance(t.length);
    } else if (at(/[A-Z_][A-Za-z0-9_]*/y)) {
      toks.push({ kind: "var", text: m![0], ...start }); advance(m![0].length);
    } else if (at(/-?\d+(\.\d+)?/y)) {
      toks.push({ kind: "number", text: m![0], value: Number(m![0]), ...start }); advance(m![0].length);
    } else if (ch === '"') {
      let j = i + 1, out = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\n") fail("unterminated string");
        if (src[j] === "\\" && j + 1 < src.length) {
          const e = src[j + 1];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e === '"' || e === "\\" ? e : "\\" + e;
          j += 2;
        } else out += src[j++];
      }
      if (j >= src.length) fail("unterminated string");
      toks.push({ kind: "string", text: src.slice(i, j + 1), value: out, ...start });
      advance(j + 1 - i);
    } else {
      const p = PUNCT.find((q) => src.startsWith(q, i));
      if (!p) fail(`unexpected character '${ch}'`);
      toks.push({ kind: "punct", text: p!, ...start }); advance(p!.length);
    }
  }
  toks.push({ kind: "eof", text: "end of input", line, column: col });
  return toks;
}

export function parse(src: string, name: string): Program {
  const toks = lex(src, name);
  let pos = 0;
  const decls = new Map<string, Decl>();
  const rules: Rule[] = [];
  const messages = new Map<string, string>();

  const peek = () => toks[pos];
  const err = (t: { line: number; column: number }, msg: string): never => { throw new RuleParseError(name, t.line, t.column, msg); };
  const isP = (text: string) => peek().kind === "punct" && peek().text === text;
  const expect = (kind: TokKind, text?: string): Tok => {
    const t = peek();
    if (t.kind !== kind || (text !== undefined && t.text !== text)) err(t, `expected ${text ?? kind} but found '${t.text}'`);
    pos++;
    return t;
  };

  const term = (): Term => {
    const t = peek();
    pos++;
    if (t.kind === "var") return t.text === "_" ? { kind: "wild" } : { kind: "var", name: t.text };
    if (t.kind === "string" || t.kind === "number" || (t.kind === "ident" && t.value !== undefined)) return { kind: "const", value: t.value! };
    return err(t, `expected a term but found '${t.text}'`);
  };
  const atom = (): Atom => {
    const t = expect("ident");
    expect("punct", "(");
    const args: Term[] = [];
    if (!isP(")")) {
      args.push(term());
      while (isP(",")) { pos++; args.push(term()); }
    }
    expect("punct", ")");
    return { rel: t.text, args, line: t.line, column: t.column };
  };
  const literal = (): Literal => {
    const t = peek();
    if (t.kind === "ident" && t.text === "not") {
      pos++;
      const a = atom();
      if (BUILTINS.has(a.rel)) return { kind: "builtin", name: a.rel as "contains", args: a.args, negated: true, line: a.line, column: a.column };
      return { kind: "atom", negated: true, ...a };
    }
    if (t.kind === "ident" && toks[pos + 1]?.text === "(") {
      const a = atom();
      if (BUILTINS.has(a.rel)) return { kind: "builtin", name: a.rel as "contains", args: a.args, negated: false, line: a.line, column: a.column };
      return { kind: "atom", negated: false, ...a };
    }
    const left = term();
    const op = peek();
    if (op.kind !== "punct" || !["=", "!=", "<", "<=", ">", ">="].includes(op.text)) err(op, `expected a comparison operator but found '${op.text}'`);
    pos++;
    if (op.text === "=" && peek().kind === "ident" && peek().text === "count") {
      pos++;
      expect("punct", ":");
      if (left.kind !== "var") err(t, "count result must be a variable");
      return { kind: "count", result: (left as { name: string }).name, atom: atom(), line: t.line, column: t.column };
    }
    return { kind: "cmp", op: op.text as CmpOp, left, right: term(), line: t.line, column: t.column };
  };

  while (peek().kind !== "eof") {
    const t = peek();
    if (t.kind === "directive") {
      pos++;
      if (t.text === ".decl") {
        const n = expect("ident");
        if (BUILTINS.has(n.text)) err(n, `'${n.text}' is a built-in`);
        if (decls.has(n.text)) err(n, `relation '${n.text}' declared twice`);
        expect("punct", "(");
        const columns: Decl["columns"] = [];
        while (!isP(")")) {
          if (columns.length) expect("punct", ",");
          const cn = peek(); pos++;
          if (cn.kind !== "var" && cn.kind !== "ident") err(cn, `expected a column name but found '${cn.text}'`);
          expect("punct", ":");
          const ty = expect("ident");
          if (!TYPES.has(ty.text)) err(ty, `unknown type '${ty.text}' (expected sym, num or bool)`);
          columns.push({ name: cn.text, type: ty.text as ColumnType });
        }
        const close = expect("punct", ")");
        let output = false;
        if (peek().kind === "directive" && peek().text === ".output" && peek().line === close.line) { pos++; output = true; }
        decls.set(n.text, { name: n.text, arity: columns.length, columns, output, line: n.line });
      } else if (t.text === ".output") {
        const n = expect("ident");
        const d = decls.get(n.text) ?? err(n, `undeclared relation '${n.text}'`);
        d.output = true;
      } else if (t.text === ".message") {
        const id = expect("string"), tpl = expect("string");
        messages.set(id.value as string, tpl.value as string);
      } else err(t, `unknown directive '${t.text}'`);
      continue;
    }
    const head = atom();
    const body: Literal[] = [];
    if (isP(":-")) {
      pos++;
      body.push(literal());
      while (isP(",")) { pos++; body.push(literal()); }
    }
    expect("punct", ".");
    const rule: Rule = { id: `${name}:${head.line}`, program: name, line: head.line, head, body };
    check(rule, decls, err);
    rules.push(rule);
  }

  const program: Program = { name, decls, rules, messages };
  stratify([program]);
  return program;
}

type Err = (t: { line: number; column: number }, msg: string) => never;

function check(rule: Rule, decls: Map<string, Decl>, err: Err): void {
  const bound = new Set<string>();
  const checkAtom = (a: Atom, what: string) => {
    const d = decls.get(a.rel) ?? err(a, `${what} relation '${a.rel}'`);
    if (d.arity !== a.args.length) err(a, `arity mismatch: '${a.rel}' has ${d.arity} columns, got ${a.args.length}`);
    a.args.forEach((t, i) => {
      if (t.kind !== "const") return;
      const ty = d.columns[i].type;
      const ok = ty === "sym" ? typeof t.value === "string" : ty === "num" ? typeof t.value === "number" : typeof t.value === "boolean";
      if (!ok) err(a, `type mismatch: column ${i + 1} of '${a.rel}' is ${ty}, got ${JSON.stringify(t.value)}`);
    });
  };
  const needBound = (terms: Term[], at: { line: number; column: number }, where: string) => {
    for (const t of terms) {
      if (t.kind === "wild") err(at, `wildcard not allowed in ${where}`);
      if (t.kind === "var" && !bound.has(t.name)) err(at, `unsafe variable '${t.name}' in ${where}: bind it in an earlier positive literal`);
    }
  };
  for (const lit of rule.body) {
    if (lit.kind === "atom") {
      checkAtom(lit, "unknown");
      if (lit.negated) needBound(lit.args.filter((t) => t.kind !== "wild"), lit, `negation of '${lit.rel}'`);
      else for (const t of lit.args) if (t.kind === "var") bound.add(t.name);
    } else if (lit.kind === "builtin") {
      if (lit.args.length !== 2) err(lit, `${lit.name}/2 takes 2 arguments, got ${lit.args.length}`);
      needBound(lit.args, lit, `${lit.name}()`);
    } else if (lit.kind === "cmp") {
      const free = (t: Term) => t.kind === "var" && !bound.has(t.name);
      if (lit.op === "=" && free(lit.left) !== free(lit.right) && lit.left.kind !== "wild" && lit.right.kind !== "wild") {
        const v = free(lit.left) ? lit.left : lit.right;
        bound.add((v as { name: string }).name);
      } else needBound([lit.left, lit.right], lit, `comparison '${lit.op}'`);
    } else {
      checkAtom(lit.atom, "unknown");
      bound.add(lit.result);
    }
  }
  checkAtom(rule.head, "undeclared");
  for (const t of rule.head.args) {
    if (t.kind === "wild") err(rule.head, "wildcard not allowed in rule head");
    if (t.kind === "var" && !bound.has(t.name)) err(rule.head, `unsafe variable '${t.name}' in head of '${rule.head.rel}'`);
  }
}
