import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FileCompare, GenomeCompare, RevisionOption, SystemCompare } from "../../../shared/api";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { SYSTEM, entry } from "../changelog/testData";
import { defaultPair } from "./pair";

const URL = `/s/${SYSTEM}/r/head/compare`;
const REVISIONS: RevisionOption[] = [
  { id: "head", kind: "head", label: "head" },
  { id: "sc-2", kind: "commit", label: "sc-2 · Add the People screen", at: "2026-01-03T00:00:00.000Z" },
  { id: "sc-1", kind: "commit", label: "sc-1 · Initial import", at: "2026-01-01T00:00:00.000Z" },
  { id: "cand.2", kind: "candidate", label: "cand.2 · agent-beta" },
];
const system: SystemCompare = {
  from: { ...entry.from!, manifest: [{ artifact: "artifact.webapp", type: "worker-fullstack", repo: "peopling-app", commit: "0".repeat(40), scope: [] }] },
  to: { ...entry.to, manifest: [{ artifact: "artifact.webapp", type: "worker-fullstack", repo: "peopling-app", commit: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", scope: [] }] },
  genome: entry.genome,
  app: entry.app,
  manifest: { templateVersions: ["worker-fullstack"], hookVersions: [], platformChanged: false },
  identical: false,
};
const genome: GenomeCompare = { from: entry.app!.from, to: entry.app!.to, delta: entry.genome.delta, files: { added: [], modified: ["system.yaml"], removed: [] } };
const file: FileCompare = {
  path: "src/index.ts",
  from: { ref: "sc-1", repo: "peopling-app", commit: "0".repeat(40), hash: "h1", text: "a\nb\nc\n", size: 6 },
  to: { ref: "head", repo: "peopling-app", commit: "a".repeat(40), hash: "h2", text: "a\nB\nc\n", size: 6 },
  truncated: false,
  binary: false,
};

const seed = (o: { system?: SystemCompare; from?: string; to?: string } = {}) => (qc: QueryClient) => {
  const from = o.from ?? "sc-1";
  const to = o.to ?? "head";
  qc.setQueryData(qk.clientMode(), "api");
  qc.setQueryData(qk.revisions(SYSTEM), { revisions: REVISIONS });
  qc.setQueryData(qk.compare(SYSTEM, "system", from, to), o.system ?? system);
  qc.setQueryData(qk.compare(SYSTEM, "genome", from, to), genome);
  qc.setQueryData(qk.compareFile(SYSTEM, "app", from, to, "src/index.ts"), file);
};
const select = (label: string) => screen.getByRole("combobox", { name: label });

describe("defaultPair", () => {
  it("defaults to head against head's parent, or the commit before `to`", () => {
    expect(defaultPair(REVISIONS, null, null)).toEqual({ from: "sc-1", to: "head" });
    expect(defaultPair(REVISIONS, null, "sc-2")).toEqual({ from: "sc-1", to: "sc-2" });
    expect(defaultPair(REVISIONS, null, "cand.2")).toEqual({ from: "head", to: "cand.2" });
    expect(defaultPair([REVISIONS[0]!], null, null)).toEqual({ from: "head", to: "head" });
  });
});

describe("Compare", () => {
  it("compares head with its parent by default and shows the System table with per-artifact commits", async () => {
    renderApp(URL, undefined, seed());
    const table = await screen.findByRole("table", { name: "System commits compared" });
    expect(select("From").textContent).toContain("sc-1");
    expect(select("To").textContent).toContain("head");
    const artifact = within(table).getByRole("row", { name: /artifact\.webapp/ });
    expect(artifact.textContent).toMatch("0000000");
    expect(artifact.textContent).toMatch("a1b2c3d");
    expect(artifact.textContent).toMatch("changed");
    expect(within(table).getByRole("row", { name: /Template worker-fullstack/ })).toBeTruthy();
    expect(screen.queryByText(/identical/)).toBeNull();
  });

  it("deep-links to a file diff with add and delete rows", async () => {
    renderApp(`${URL}?level=files&path=src/index.ts`, undefined, seed());
    const diff = await screen.findByRole("table", { name: "src/index.ts" });
    expect(diff.querySelectorAll('[data-op="del"]')).toHaveLength(1);
    expect(diff.querySelectorAll('[data-op="add"]')).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    const app = screen.getByRole("region", { name: "App files" });
    expect(within(app).getByRole("link", { name: "src/screens/People.tsx" }).getAttribute("href")).toContain("level=files");
    expect(within(screen.getByRole("region", { name: "Genome files" })).getByRole("link", { name: "system.yaml" }).getAttribute("href")).toContain("repo=genome");
  });

  it("swaps the two sides", async () => {
    const { router } = renderApp(URL, undefined, seed());
    await screen.findByRole("table", { name: "System commits compared" });
    fireEvent.click(screen.getByRole("button", { name: "Swap" }));
    await waitFor(() => {
      const q = new URLSearchParams(router.state.location.search);
      expect([q.get("from"), q.get("to")]).toEqual(["head", "sc-1"]);
    });
  });

  it("shows the Genome delta with field before/after", async () => {
    renderApp(URL, undefined, seed());
    fireEvent.click(await screen.findByRole("tab", { name: "Genome" }));
    expect(await screen.findByLabelText("name before")).toBeTruthy();
    expect(screen.getByLabelText("name after")).toBeTruthy();
  });

  it("notes in the header when a side's Genome is in the v1 format", async () => {
    renderApp(URL, undefined, seed({ system: { ...system, genome: { ...system.genome, delta: null, legacyFormat: ["from"] } } }));
    expect(await screen.findByRole("note")).toHaveProperty("textContent", "Genome v1 format — not comparable");
  });

  it("says when the two revisions are identical", async () => {
    renderApp(URL, undefined, seed({ system: { ...system, identical: true } }));
    expect(await screen.findByText("The two revisions are identical.")).toBeTruthy();
  });

  it("explains that fixture data has a single revision", async () => {
    renderApp(URL);
    expect(await screen.findByText("Compare needs the platform API.")).toBeTruthy();
    fireEvent.keyDown(select("From"), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "head" })).toBeTruthy();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });
});
