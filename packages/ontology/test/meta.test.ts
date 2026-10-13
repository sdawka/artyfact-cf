import { describe, expect, it } from "vitest";
import { instantiateNodes, loadTemplate, memoryStore, parseCardinality, templateHash } from "../src/index.ts";
import { base, board } from "./fixture.ts";

describe("cardinality", () => {
  it("parses the grammar", () => {
    expect(parseCardinality("1")).toEqual({ min: 1, max: 1 });
    expect(parseCardinality("0..1")).toEqual({ min: 0, max: 1 });
    expect(parseCardinality("1..*")).toEqual({ min: 1, max: null });
    expect(parseCardinality("0..5")).toEqual({ min: 0, max: 5 });
  });
  it("rejects malformed and inverted bounds", () => {
    expect(() => parseCardinality("*")).toThrow(SyntaxError);
    expect(() => parseCardinality("3..1")).toThrow(/upper bound/);
  });
});

describe("loadTemplate", () => {
  it("resolves extends with the child winning", () => {
    const t = loadTemplate(board(), memoryStore([base()]));
    expect(t.ref).toBe("template.test.board@1");
    expect(t.lineage).toEqual(["template.test.board@1", "template.test.base@1"]);
    expect(Object.keys(t.kinds).sort()).toEqual(["board", "card", "person"]);
    expect(t.constraints.exactlyOne.map((c) => c.id)).toEqual(["person.contact"]);
    expect(t.relations.blocks.cardinality).toEqual({ out: "0..*", in: "0..2" });
  });
  it("rejects templates that do not conform to meta@1", () => {
    expect(() => loadTemplate({ ...board(), meta: 2 })).toThrow();
    expect(() => loadTemplate({ ...board(), kinds: { card: { feilds: [] } } })).toThrow();
    expect(() => loadTemplate({ ...board(), relations: { r: { from: ["card"], to: ["card"], cardinality: { out: "x" } } } })).toThrow();
  });
  it("hashes deterministically and independently of key order", () => {
    const store = memoryStore([base()]);
    const a = loadTemplate(board(), store);
    const b = loadTemplate(Object.fromEntries(Object.entries(board()).reverse()), store);
    expect(a.hash).toBe(b.hash);
    expect(templateHash(a)).toBe(a.hash);
    expect(loadTemplate({ ...board(), version: 2 }, store).hash).not.toBe(a.hash);
  });
  it("instantiates $self in prefilled nodes", () => {
    const t = loadTemplate(board(), memoryStore([base()]));
    expect(instantiateNodes(t, "b9")).toEqual([{ id: "b9.inbox", kind: "card", parent: "b9", fields: { title: "Inbox for b9" } }]);
  });
});
