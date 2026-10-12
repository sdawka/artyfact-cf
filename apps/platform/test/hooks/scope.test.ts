import { describe, expect, it } from "vitest";
import { diffScope } from "../../worker/hooks/diff-scope";

const base = {
  target: "app" as const,
  permitted: ["src/ui/**", "src/worker/routes/**"],
  protected: ["system/**", "assays/**"],
};

describe("diff scope engine", () => {
  it("passes when every change is permitted and mapped", () => {
    const o = diffScope({ ...base, changedPaths: ["src/ui/people.tsx"], changedNodes: ["screen.people"] });
    expect(o).toMatchObject({ execution: "completed", verdict: "pass" });
  });

  it("fails when a change falls outside the permitted globs", () => {
    const o = diffScope({ ...base, changedPaths: ["src/ui/a.tsx", "package.json"], changedNodes: ["screen.people"] });
    expect(o.verdict).toBe("fail");
    expect(o.observations).toContainEqual({ outsidePermitted: ["package.json"] });
  });

  it("fails with 'Genome amendment required' when an app realization touches system/**", () => {
    const o = diffScope({ ...base, changedPaths: ["system/things/webapp/ontology.yaml"], changedNodes: ["genome"] });
    expect(o.verdict).toBe("fail");
    expect(o.interpretation).toContain("Genome amendment required");
    expect(o.observations).toContainEqual({ protectedTouched: ["system/things/webapp/ontology.yaml"] });
  });

  it("is unknown when a changed path is unmapped, listing it", () => {
    const o = diffScope({ ...base, changedPaths: ["src/ui/new.tsx"], changedNodes: ["unmapped:src/ui/new.tsx"] });
    expect(o).toMatchObject({ execution: "completed", verdict: "unknown" });
    expect(o.observations).toContainEqual({ unmapped: ["src/ui/new.tsx"] });
  });

  it("protected beats unmapped", () => {
    const o = diffScope({ ...base, changedPaths: ["assays/x.ts"], changedNodes: ["unmapped:assays/x.ts"] });
    expect(o.verdict).toBe("fail");
  });

  it("is unknown for an empty change set rather than a vacuous pass", () => {
    expect(diffScope({ ...base, changedPaths: [], changedNodes: [] }).verdict).toBe("unknown");
  });

  it("is an error when no permitted globs are given", () => {
    const o = diffScope({ ...base, permitted: [], changedPaths: ["a"], changedNodes: ["x"] });
    expect(o).toMatchObject({ execution: "error", verdict: "unknown" });
  });

  it("matches dotfiles", () => {
    const o = diffScope({ ...base, permitted: ["src/**"], changedPaths: ["src/.env.example"], changedNodes: ["section.ui"] });
    expect(o.verdict).toBe("pass");
  });

  it("treats CLI-written files as always permitted and mapped, listing them as platform-written", () => {
    const written = ["TASK_PACKET.md", "AGENTS.md", ".artyfact/candidate.json", ".artyfact/packet.json"];
    const o = diffScope({
      ...base,
      changedPaths: ["src/ui/people.tsx", ...written],
      changedNodes: ["screen.people", ...written.map((p) => `unmapped:${p}`)],
    });
    expect(o).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(o.observations).toContainEqual({ platformWritten: written });
  });

  it("does not exempt look-alikes in subdirectories", () => {
    const o = diffScope({ ...base, changedPaths: ["docs/AGENTS.md"], changedNodes: ["unmapped:docs/AGENTS.md"] });
    expect(o.verdict).toBe("fail");
  });

  it("a change set of only platform-written files is unknown, not a vacuous pass", () => {
    const o = diffScope({ ...base, changedPaths: ["TASK_PACKET.md"], changedNodes: ["unmapped:TASK_PACKET.md"] });
    expect(o.verdict).toBe("unknown");
    expect(o.observations).toContainEqual({ platformWritten: ["TASK_PACKET.md"] });
  });
});
