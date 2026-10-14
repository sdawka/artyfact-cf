import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.peopling";
const ref = { ref: "head", repo: "genome", commit: "a".repeat(40) };

function openInCode(files: { path: string; hash: string; nodes?: string[] }[], focus = "GD.contacts") {
  renderApp(`/s/${SYSTEM}/r/head/overview?focus=${focus}`, undefined, (qc) => qc.setQueryData(qk.tree(SYSTEM, "genome", "head"), { ref, files }));
  return screen.findByRole("complementary", { name: "Inspector" }).then((inspector) => within(inspector));
}

describe("Inspector header: Open in Code", () => {
  it("links the node's own node.yaml (its origin) over another file mapped to it", async () => {
    const inspector = await openInCode([{ path: "GD.contacts/README.md", hash: "h", nodes: ["GD.contacts"] }]);
    await waitFor(() => {
      const href = inspector.getByRole("link", { name: "Open in Code" }).getAttribute("href")!;
      expect(new URLSearchParams(href.split("?")[1]).get("path")).toBe("GD.contacts/node.yaml");
    });
  });

  it("links the declaring node.yaml of a node with no source document", async () => {
    const path = "thing.webapp/section.runtime/node.yaml";
    const inspector = await openInCode([{ path, hash: "h", nodes: ["section.runtime"] }], "section.runtime");
    const href = (await inspector.findByRole("link", { name: "Open in Code" })).getAttribute("href")!;
    expect(new URLSearchParams(href.split("?")[1]).get("path")).toBe(path);
  });

  it("opens the System's own node.yaml, not a README.md that also maps to it", async () => {
    const files = [{ path: "README.md", hash: "h", nodes: [SYSTEM] }, { path: "node.yaml", hash: "h", nodes: [SYSTEM] }];
    const inspector = await openInCode(files, SYSTEM);
    const href = (await inspector.findByRole("link", { name: "Open in Code" })).getAttribute("href")!;
    expect(new URLSearchParams(href.split("?")[1]).get("path")).toBe("node.yaml");
  });
});

describe("Inspector header: Open in Review", () => {
  const BASE = `/s/${SYSTEM}/r/head`;
  const node = "entity.ContactRecord";
  const realization = (id: string, candidate: string) => ({
    id, evolution: "evolution.1", candidate, status: "evaluated", target: "app", agent: { id: "a", role: "implementer" },
    workspace: { repo: "r", fork: "f", baseCommit: "b" }, checkpoints: [],
  });
  const cand = (id: string, realizationId: string, changedSubjects: string[]) => ({
    id, realization: realizationId, evolution: "evolution.1", commit: "c", baseRevision: "", changedPaths: [], changedSubjects, genomeChanges: [], submittedAt: "", state: "evaluated",
  });
  const open = (query: string, candidates: ReturnType<typeof cand>[], realizations: ReturnType<typeof realization>[]) => {
    renderApp(`${BASE}/overview?focus=${node}${query}`, undefined, (qc) => {
      qc.setQueryData(qk.evolutions(SYSTEM), { evolutions: [], realizations });
      qc.setQueryData(qk.candidates(SYSTEM, "evolution.1"), { evolution: "evolution.1", candidates, evaluations: [], conflicts: [] });
      qc.setQueryData(qk.history(SYSTEM), { commits: [] });
    });
    return screen.findByRole("complementary", { name: "Inspector" }).then((inspector) => within(inspector));
  };

  it("offers Work when no candidate touches the node", async () => {
    const inspector = await open("", [], []);
    expect(await inspector.findByRole("button", { name: "Open in Work" })).toBeTruthy();
    expect(inspector.queryByRole("link", { name: "Open in Review" })).toBeNull();
  });

  it("offers Review, at the touching candidate, when a waiting candidate changes the node", async () => {
    const inspector = await open("", [cand("cand.1", "realization.1", [node])], [realization("realization.1", "cand.1")]);
    const link = await inspector.findByRole("link", { name: "Open in Review" });
    expect(link.getAttribute("href")).toBe(`${BASE}/review?focus=${node}&evolution=evolution.1&realization=realization.1`);
    expect(inspector.queryByRole("button", { name: "Open in Work" })).toBeNull();
    expect(inspector.getByText("In 1 candidate")).toBeTruthy();
  });

  it("says overlap when two candidates in ?candidates= touch it", async () => {
    const cands = [cand("cand.1", "realization.1", [node]), cand("cand.2", "realization.2", [node])];
    const inspector = await open("&candidates=cand.1,cand.2", cands, [realization("realization.1", "cand.1"), realization("realization.2", "cand.2")]);
    expect(await inspector.findByText("In 2 candidates, overlapping")).toBeTruthy();
  });
});
