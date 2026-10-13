import { describe, expect, it } from "vitest";
import { index } from "../src/index";
import { load } from "./helpers";

describe("index", () => {
  const m = load();
  const ix = m.index;

  it("indexes every identified object by id", () => {
    for (const id of ["system.mini", "thing.app", "screen.list", "ext.owner", "P1", "T1", "GD.notes", "S.app.notes", "C.app.exists", "hook.app.exists", "J.notes", "evolution.1"]) {
      expect(ix.byId[id], id).toBeDefined();
    }
    expect(ix.byId["screen.list"]).toMatchObject({ type: "node", kind: "screen", name: "Notes" });
    expect(ix.byId["ext.owner"]).toMatchObject({ type: "external", kind: "external" });
  });

  // Siblings follow the node tree's directory order; v2 has no order field.
  it("builds containment children from system down", () => {
    expect(ix.children["system.mini"]).toEqual(["thing.app"]);
    expect(ix.children["thing.app"]).toEqual(["section.domain", "section.ui"]);
    expect(ix.children["section.ui"]).toEqual(["component.AppShell", "screen.edit", "screen.list"]);
  });

  it("makes linksIn the exact inverse of linksOut, keeping link labels", () => {
    const out = Object.values(ix.linksOut).flat();
    const inn = Object.values(ix.linksIn).flat();
    expect(inn).toHaveLength(out.length);
    for (const l of out) expect(ix.linksIn[l.to]).toContainEqual(l);
    for (const l of inn) expect(ix.linksOut[l.from]).toContainEqual(l);
    expect(ix.linksIn["operation.note.save"].map((l) => l.from).sort()).toEqual(["affordance.NoteForm.save", "policy.ownerOnly"]);
    expect(ix.linksOut["ext.owner"]).toEqual([{ from: "ext.owner", rel: "invokes", to: "affordance.NoteForm.save", certainty: "declared", label: "saves" }]);
  });

  it("indexes criteria, hooks, journeys and requirements", () => {
    expect(ix.criteriaBySubject["affordance.NoteForm.save"]).toEqual(["C.app.notes.save"]);
    expect(ix.criteriaByOwner["thing.app"].sort()).toEqual(["C.app.exists", "C.app.notes.save"]);
    expect(ix.hooksByCriterion["C.app.exists"]).toEqual(["hook.app.exists"]);
    expect(ix.journeysByNode["screen.edit"]).toEqual(["J.notes"]);
    expect(ix.journeysByNode["operation.note.save"]).toEqual(["J.notes"]);
    expect(ix.requirementsByNode["screen.list"]).toEqual(["S.app.notes"]);
  });

  it("answers path() and layer()", () => {
    expect(ix.path("affordance.NoteForm.save")).toEqual([
      "system.mini", "thing.app", "section.ui", "screen.edit", "component.NoteForm", "affordance.NoteForm.save",
    ]);
    expect(ix.path("C.app.exists")).toEqual(["C.app.exists"]);
    expect(ix.path("nope")).toEqual([]);
    expect(ix.layer("affordance.NoteForm.save")).toBe("section.ui");
    expect(ix.layer("entity.Note")).toBe("section.domain");
    expect(ix.layer("section.ui")).toBe("section.ui");
    expect(ix.layer("thing.app")).toBeUndefined();
  });

  it("answers depthOf() from graph containment and layerOf() from the composed template's view", () => {
    expect(ix.depthOf("system.mini")).toBe(0);
    expect(ix.depthOf("thing.app")).toBe(1);
    expect(ix.depthOf("affordance.NoteForm.save")).toBe(5);
    expect(ix.depthOf("nope")).toBeUndefined();
    expect(ix.layerOf("screen.list")).toBe("experience");
    expect(ix.layerOf("nope")).toBeUndefined();
  });

  it("is rebuildable from a JSON round-trip of the model", () => {
    const { index: _drop, graph, template, ...rest } = m;
    const plain = { ...JSON.parse(JSON.stringify(rest)), graph, template };
    const ix2 = index(plain);
    expect(ix2.children).toEqual(ix.children);
    expect(ix2.path("screen.list")).toEqual(ix.path("screen.list"));
  });
});
