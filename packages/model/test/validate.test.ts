import { describe, expect, it, vi } from "vitest";
import { loadSystem, validate } from "../src/index";
import { sha256 } from "../src/sha256";
import { edit, pack, readTree, store } from "./helpers";

vi.mock("@artyfact/rules", () => import("./stubs/rules"));

const files = readTree();
const run = (f: Map<string, string>) => validate(loadSystem(f, { templates: store() }), [pack]);
const errors = (r: ReturnType<typeof run>) => r.findings.filter((x) => x.level === "error");

describe("validate", () => {
  it("clean fixture → 0 errors, actionable, pinned pack hash", () => {
    const r = run(files);
    expect(errors(r)).toEqual([]);
    expect(r.actionable).toBe(true);
    expect(r.incomplete).toBe(false);
    expect(r.packs).toEqual([{ id: "test.pack", version: "1", hash: sha256(pack.source) }]);
    expect(r.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("folds warning/semanticCandidate into warning/info findings", () => {
    const r = run(files);
    expect(r.findings).toContainEqual(expect.objectContaining({ level: "warning", rule: "hook.unbound", subject: "C.app.notes.save" }));
    const f = edit(files, "things/app/ontology.yaml", "Persists the note for its owner", "Sends the note to every Recipient");
    const s = run(f);
    expect(s.findings).toContainEqual(expect.objectContaining({ level: "info", rule: "semantic:topology.multiRecipient", subject: "affordance.NoteForm.save" }));
    expect(s.actionable).toBe(true);
  });

  it("removing the policy link → authz.ungoverned error with derivation", () => {
    const f = edit(files, "things/app/ontology.yaml", "      - { rel: governs, to: operation.note.save }\n", "");
    const r = run(f);
    const e = errors(r);
    expect(e.map((x) => [x.rule, x.subject])).toEqual([["authz.ungoverned", "operation.note.save"]]);
    expect(e[0].message).toBe("Operation operation.note.save writes data but no authorization policy governs it.");
    expect(e[0].pack).toBe("test.pack@1");
    expect(e[0].derivation.relation).toBe("violation");
    expect(e[0].derivation.children.map((c) => c.relation)).toEqual(["mutating"]);
    expect(e[0].facts).toContainEqual(["link", "operation.note.save", "writes", "entity.Note", "declared"]);
    expect(r.derived.violation).toContainEqual(["authz.ungoverned", "operation.note.save", "hard"]);
    expect(r.actionable).toBe(false);
  });

  it("dangling link → ref.dangling", () => {
    const f = edit(files, "things/app/ontology.yaml", "{ rel: reads, to: entity.Note }", "{ rel: reads, to: entity.Ghost }");
    expect(errors(run(f)).map((x) => [x.rule, x.subject])).toEqual([["ref.dangling", "operation.note.list"]]);
  });

  it("removing a template section → template.sectionMissing", () => {
    const f = edit(files, "things/app/thing.yaml", "sections: [section.ui, section.domain]", "sections: [section.ui]");
    const e = errors(run(f));
    expect(e.map((x) => [x.rule, x.subject])).toEqual([["template.sectionMissing", "thing.app"]]);
    expect(e[0].message).toBe("template.sectionMissing"); // no .message → rule id
  });

  it("missing → missing findings; soft violations → warnings", () => {
    const f = edit(files, "things/app/criteria.yaml", /hooks:\n  - id: hook\.app\.notes\.save[\s\S]*$/, "");
    const g = edit(f, "things/app/criteria.yaml", "    hooks: [hook.app.notes.save]\n", "");
    const r = run(g);
    expect(r.findings).toContainEqual(expect.objectContaining({ level: "missing", rule: "coverage.hook", subject: "C.app.notes.save" }));
    expect(r.actionable).toBe(true);

    const soft = { ...pack, source: pack.source + '\nviolation("kit.soft",K,"soft") :- node(K,"policy",_).\n' };
    const s = validate(loadSystem(files, { templates: store() }), [soft]);
    expect(s.findings).toContainEqual(expect.objectContaining({ level: "warning", rule: "kit.soft", subject: "policy.ownerOnly" }));
    expect(s.actionable).toBe(true);
  });
});
