import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.keep-in-touch";
const ref = { ref: "head", repo: "genome", commit: "a".repeat(40) };
const DOC = "keep-in-touch-world-specification";

function openInCode(files: { path: string; hash: string; nodes?: string[] }[]) {
  renderApp(`/s/${SYSTEM}/r/head/overview?focus=GD.contacts`, undefined, (qc) => qc.setQueryData(qk.tree(SYSTEM, "genome", "head"), { ref, files }));
  return screen.findByRole("complementary", { name: "Inspector" }).then((inspector) => within(inspector));
}

describe("Inspector header: Open in Code", () => {
  it("links the Genome file that maps to the node, not the document id", async () => {
    const inspector = await openInCode([{ path: "description.yaml", hash: "h", nodes: ["GD.contacts"] }]);
    await waitFor(() => {
      const href = inspector.getByRole("link", { name: "Open in Code" }).getAttribute("href")!;
      expect(new URLSearchParams(href.split("?")[1]).get("path")).toBe("description.yaml");
    });
  });

  it("falls back to the document id when no file maps to the node", async () => {
    const inspector = await openInCode([{ path: "purpose.yaml", hash: "h", nodes: ["other"] }]);
    const href = (await inspector.findByRole("link", { name: "Open in Code" })).getAttribute("href")!;
    expect(new URLSearchParams(href.split("?")[1]).get("path")).toBe(DOC);
  });
});
