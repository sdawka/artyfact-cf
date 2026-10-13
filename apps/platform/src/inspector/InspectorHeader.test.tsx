import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.keep-in-touch";
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
