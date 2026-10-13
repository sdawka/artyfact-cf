import { Document, isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import { canon } from "../canon.ts";
import { EVOLUTIONS_DIR, NODE_FILE, NodeFileSchema, slugOf, type NodeCriterion, type NodeFile, type NodeLink } from "../genome/node.ts";
import { entriesOf, parseTree, type GenomeFiles } from "./tree.ts";

/**
 * Ops -> file changes on a v2 Genome (`docs/design/ontology.md` §4). Edits go through the `yaml` Document API, so
 * comments, key order and flow style survive, and only the directories of the nodes the ops name change.
 */

/** The op shape the writer applies; the platform's `ProposedOp` is one. `node` is the minted id on an `add`. */
export interface TreeOp {
  op: "add" | "update" | "remove" | "link" | "unlink";
  /** The node the op is about (the `from` end of a link). Optional on `add`, which then mints `<kind>.<slug of title>`. */
  node?: string;
  kind?: string;
  /** `add` only; absent puts the node under the root. */
  parent?: string;
  /** `add`: the new node's fields. `update`: fields to set; `null` deletes the key. */
  fields?: Record<string, unknown>;
  /** `add`: outgoing links of the new node. */
  links?: NodeLink[];
  link?: NodeLink;
  /** `add`: the node's criteria. `update`: upserts by id; `{id, remove: true}` deletes one. */
  criteria?: (NodeCriterion | { id: string; remove: true })[];
}

export interface FileChange { path: string; content: string | null }

export interface ApplyResult {
  /** Sorted by path; `null` content deletes the file. */
  changes: FileChange[];
  /** Added, updated and removed node ids (a removed subtree counts every node in it) and the `from` end of each link change. */
  touched: string[];
}

export class TreeOpError extends Error {
  readonly op: number;
  constructor(op: number, message: string) {
    super(`op ${op}: ${message}`);
    this.name = "TreeOpError";
    this.op = op;
  }
}

/** Top-level `node.yaml` keys in the order a writer emits them. */
const KEY_ORDER = ["id", "kind", "template", "root", "fields", "links", "files", "criteria", "provisional"] as const;

/** A new `node.yaml`: keys in schema order, links as one-line flow maps, no aliases, no line folding. */
export function formatNodeFile(file: NodeFile): string {
  const ordered = Object.fromEntries(KEY_ORDER.filter((k) => file[k] !== undefined).map((k) => [k, file[k]]));
  const doc = new Document(ordered, { aliasDuplicateObjects: false });
  const links = doc.get("links");
  if (isSeq(links)) for (const l of links.items) if (isMap(l)) l.flow = true;
  return doc.toString({ lineWidth: 0 });
}

/**
 * A new node id, `<kind>.<slug of title>`, with `-2`, `-3`, ... on collision. The slug keeps letters, digits and
 * `.`/`_`/`-`, with every other run of characters replaced by `-`.
 */
export function mintId(kind: string, title: string, taken: ReadonlySet<string>): string {
  const slug = title.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|-+$/g, "") || "node";
  const base = `${kind}.${slug}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** Sets `key` on the document root, inserting a new key at its schema position. */
function setTop(doc: Document, key: string, value: unknown) {
  const map = doc.contents as YAMLMap;
  if (map.has(key)) { map.set(key, value); return; }
  const node = doc.createPair(key, value);
  const rank = KEY_ORDER.indexOf(key as (typeof KEY_ORDER)[number]);
  const at = map.items.findIndex((p) => KEY_ORDER.indexOf(String((p.key as { value?: unknown })?.value ?? p.key) as (typeof KEY_ORDER)[number]) > rank);
  map.items.splice(at < 0 ? map.items.length : at, 0, node);
}

/** Drops a top-level collection left empty by an edit, so a round-trip never grows keys. */
function dropIfEmpty(doc: Document, key: string) {
  const v = doc.get(key);
  if ((isSeq(v) || isMap(v)) && v.items.length === 0) doc.delete(key);
}

/**
 * Applies `ops` in order to the Genome `files` and returns the file changes. Ops may name nodes added earlier in the
 * same batch. Throws `TreeOpError` for an op that cannot apply (unknown node, existing id, removing the root, an
 * edit that leaves an invalid `node.yaml`) and `GenomeTreeError` when the result is not a valid tree.
 */
export function applyOps(files: GenomeFiles, ops: readonly TreeOp[]): ApplyResult {
  const original = new Map(entriesOf(files));
  const tree = parseTree(original);
  const work = new Map(original);
  const dirs = new Map([...tree.nodes.values()].map((n) => [n.id, n.dir]));
  const docs = new Map<string, Document>();
  const touched: string[] = [];
  const touch = (id: string) => { if (!touched.includes(id)) touched.push(id); };
  const fileOf = (dir: string) => (dir ? `${dir}/${NODE_FILE}` : NODE_FILE);

  ops.forEach((op, i) => {
    const fail = (message: string): never => { throw new TreeOpError(i, message); };
    const docOf = (id: string | undefined) => {
      const dir = id === undefined ? undefined : dirs.get(id);
      if (dir === undefined) return fail(`unknown node ${id}`);
      const path = fileOf(dir);
      let doc = docs.get(path);
      if (!doc) { doc = parseDocument(work.get(path)!); docs.set(path, doc); }
      return { doc, path };
    };
    const check = (doc: Document, path: string) => {
      const r = NodeFileSchema.safeParse(doc.toJS());
      if (!r.success) fail(`${path}: ${r.error.issues.map((x) => (x.path.length ? `${x.path.join(".")}: ` : "") + x.message).join("; ")}`);
    };

    switch (op.op) {
      case "add": {
        if (!op.kind) fail("add needs a kind");
        const title = op.fields?.title ?? op.fields?.name;
        const id = op.node ?? mintId(op.kind!, typeof title === "string" ? title : "", new Set(dirs.keys()));
        if (dirs.has(id)) fail(`node ${id} already exists`);
        const parentDir = dirs.get(op.parent ?? tree.root);
        if (parentDir === undefined) fail(`unknown parent ${op.parent}`);
        const taken = (d: string) => [...work.keys()].some((p) => p.startsWith(`${d}/`)) || (!parentDir && d === EVOLUTIONS_DIR);
        const slug = slugOf(id);
        let dir = parentDir ? `${parentDir}/${slug}` : slug;
        for (let n = 2; taken(dir); n++) dir = `${parentDir ? `${parentDir}/` : ""}${slug}-${n}`;
        const file: NodeFile = {
          id, kind: op.kind!,
          ...(op.fields && Object.keys(op.fields).length && { fields: Object.fromEntries(Object.entries(op.fields).filter(([, v]) => v !== null)) }),
          ...(op.links?.length && { links: op.links }),
          ...(op.criteria?.length && { criteria: op.criteria as NodeCriterion[] }),
        };
        const r = NodeFileSchema.safeParse(file);
        if (!r.success) fail(r.error.issues.map((x) => (x.path.length ? `${x.path.join(".")}: ` : "") + x.message).join("; "));
        const path = fileOf(dir);
        work.set(path, formatNodeFile(r.data!));
        docs.delete(path);
        dirs.set(id, dir);
        touch(id);
        break;
      }
      case "update": {
        const { doc, path } = docOf(op.node);
        for (const [k, v] of Object.entries(op.fields ?? {})) {
          if (v === null) doc.deleteIn(["fields", k]);
          else if (!same(((doc.toJS() as NodeFile).fields ?? {})[k], v)) {
            if (doc.has("fields")) doc.setIn(["fields", k], v);
            else setTop(doc, "fields", { [k]: v });
          }
        }
        dropIfEmpty(doc, "fields");
        for (const c of op.criteria ?? []) {
          let seq = doc.get("criteria");
          const at = isSeq(seq) ? seq.items.findIndex((x) => isMap(x) && x.get("id") === c.id) : -1;
          if ("remove" in c && c.remove === true) {
            if (at < 0) fail(`node ${op.node} has no criterion ${c.id}`);
            (seq as YAMLSeq).items.splice(at, 1);
            continue;
          }
          if (!isSeq(seq)) { setTop(doc, "criteria", []); seq = doc.get("criteria"); }
          const items = (seq as YAMLSeq).items;
          if (at < 0) { items.push(doc.createNode(c)); continue; }
          const item = items[at] as YAMLMap;
          const next = c as Record<string, unknown>;
          for (const k of item.items.map((p) => String((p.key as { value?: unknown })?.value ?? p.key))) if (!(k in next)) item.delete(k);
          const current = (item.toJSON() ?? {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(next)) if (!same(current[k], v)) item.set(k, doc.createNode(v));
        }
        dropIfEmpty(doc, "criteria");
        check(doc, path);
        touch(op.node!);
        break;
      }
      case "remove": {
        const dir = dirs.get(op.node ?? "");
        if (dir === undefined) fail(`unknown node ${op.node}`);
        if (dir === "") fail("cannot remove the root node");
        for (const p of [...work.keys()]) if (p.startsWith(`${dir}/`)) { work.delete(p); docs.delete(p); }
        for (const [id, d] of [...dirs]) if (d === dir || d.startsWith(`${dir}/`)) { dirs.delete(id); touch(id); }
        break;
      }
      case "link":
      case "unlink": {
        if (!op.link) fail(`${op.op} needs a link`);
        const { rel, to } = op.link!;
        const { doc, path } = docOf(op.node);
        const seq = doc.get("links");
        const matches = (x: unknown) => isMap(x) && x.get("rel") === rel && x.get("to") === to;
        if (op.op === "link") {
          if (isSeq(seq) && seq.items.some(matches)) break;
          const item = doc.createNode(Object.fromEntries(Object.entries(op.link!).filter(([, v]) => v !== undefined))) as YAMLMap;
          item.flow = isSeq(seq) && seq.items.length ? (seq.items[seq.items.length - 1] as YAMLMap).flow ?? false : true;
          if (isSeq(seq)) seq.items.push(item);
          else { const fresh = new YAMLSeq(); fresh.items.push(item); setTop(doc, "links", fresh); }
        } else {
          if (!isSeq(seq) || !seq.items.some(matches)) break;
          seq.items = seq.items.filter((x) => !matches(x));
          dropIfEmpty(doc, "links");
        }
        check(doc, path);
        touch(op.node!);
        break;
      }
      default:
        fail(`unknown op ${(op as { op: string }).op}`);
    }
  });

  // A document whose content did not change keeps its text byte for byte.
  for (const [path, doc] of docs) {
    if (work.has(path) && !same(doc.toJS(), parseDocument(work.get(path)!).toJS())) work.set(path, doc.toString({ lineWidth: 0 }));
  }
  // The edited tree must still parse; this also catches ids an op duplicated (criteria, hooks).
  parseTree(work);
  const changes: FileChange[] = [];
  for (const path of new Set([...original.keys(), ...work.keys()])) {
    const before = original.get(path), after = work.get(path);
    if (before !== after) changes.push({ path, content: after ?? null });
  }
  changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { changes, touched };
}
