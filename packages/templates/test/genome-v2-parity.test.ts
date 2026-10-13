// Delete with the v1 reader: this is the migration's acceptance test (docs/design/ontology.md §2a), and it goes when
// `convertV1` and the engine's artyfact v1 adapter are removed after the migration release.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artyfactTemplateStore, evaluate, loadArtyfactSystem, readTree, type Finding } from "@artyfact/ontology";
import { readDir } from "@artyfact/ontology/artyfact/node";
import { convertV1 } from "@artyfact/ontology/codec/v1";
import { composeTemplate, metaTemplates } from "../src/index";
import { files as bundled } from "../src/generated/files";

const templatesDir = Object.fromEntries(Object.entries(bundled).filter(([p]) => !p.startsWith("rule-packs/")));
const v1 = readDir(join(__dirname, "../../ontology/test/fixtures/artyfact/keep-in-touch-system"));
const SYSTEM = "template.system.social-networking.cloudflare@1";
const template = composeTemplate(SYSTEM, ["template.thing.cloudflare-worker-webapp@1"]);
// The v1 adapter names its base template; the tree names the root's, which the composed template keeps.
const v1Graph = { ...loadArtyfactSystem(v1, { templates: artyfactTemplateStore(templatesDir) }), template: SYSTEM };
const v2Graph = readTree(convertV1(v1, templatesDir), metaTemplates);

/** Kinds v1 left parentless and the tree places (the three intended parent differences). */
const PLACED = new Set(["purpose", "claim", "external", "feature", "commitment", "journey", "requirement"]);
const key = (f: Finding) => `${f.rule} ${f.subject ?? ""} ${f.level}`;

describe("Genome v2 findings parity (Keep in Touch)", () => {
  const before = evaluate(template, v1Graph).findings;
  const after = evaluate(template, v2Graph).findings;
  const afterKeys = new Set(after.map(key)), beforeKeys = new Set(before.map(key));

  it("the converted tree raises no finding the v1 Genome did not", () => {
    expect(v2Graph.template).toBe(template.ref);
    expect(after.filter((f) => f.rule === "graph.templateMismatch")).toEqual([]);
    expect(after.map(key).filter((k) => !beforeKeys.has(k))).toEqual([]);
  });

  it("drops exactly the missing-parent findings of the kinds the tree places", () => {
    const kinds = new Map(v1Graph.nodes.map((n) => [n.id, n.kind]));
    const dropped = before.filter((f) => !afterKeys.has(key(f)));
    expect(dropped.every((f) => f.rule === "tree.parentRequired" && PLACED.has(kinds.get(f.subject!)!))).toBe(true);
    const placed = v1Graph.nodes.filter((n) => PLACED.has(n.kind)).map((n) => n.id).sort();
    expect(dropped.map((f) => f.subject).sort()).toEqual(placed);
    expect(after.length).toBe(before.length - placed.length);
    expect(after.length).toBeGreaterThan(30);
  });
});
