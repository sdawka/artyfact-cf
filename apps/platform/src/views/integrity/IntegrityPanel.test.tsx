import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { IntegrityPanel } from "./IntegrityPanel";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, } from "@testing-library/react";
import { testQueryClient } from "@/testing/render";

it("labels automated and human integrity results separately, including partial coverage", async () => {
  const run = {
    id: "run.one", systemId: "system.demo", snapshotId: "snapshot.one", snapshotHash: "sha256:s", provider: "off", requestedCalls: 200, attempt: 1,
    state: "completed", createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:00Z", reviewUrl: "/s/system.demo/r/head/review?integrity=run.one",
    report: { version: 1, id: "report.one", systemId: "system.demo", snapshotHash: "sha256:s", policyVersion: "integrity.v1", createdAt: "2026-10-14T00:00:00Z", status: "needs-review",
      structural: { status: "passed", complete: true, findings: [], limitations: [], checkedSubjects: ["system.demo"], checkedRelationships: [] },
      semantic: { status: "needs-review", complete: false, intentFidelity: "checked", findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [{ id: "coverage", section: "semantic", severity: "warning", code: "coverage.partial", message: "Only a bounded slice was checked", subjects: [], evidence: [] }], provenance: { provider: "off", model: "", questions: [], thresholds: {}, budget: { requestedCalls: 200, maxCalls: 200, usedCalls: 0 }, truncated: false, fake: true, retries: 0 } },
    }, agreement: { status: "pending", actor: "", at: "", reportId: "report.one", snapshotHash: "sha256:s", dispositions: [], eligibility: { eligible: false, status: "pending", unresolvedFindingIds: ["coverage"], reason: "semantic evaluation must be completed or retried" } },
  } as any;
  const router = createMemoryRouter([{ path: "/s/:systemId/r/:rev/work", element: <IntegrityPanel run={run} /> }], { initialEntries: ["/s/system.demo/r/head/work"] });
  render(<QueryClientProvider client={testQueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
  expect(await screen.findByText(/Automated result: needs-review/)).toBeTruthy();
  expect(screen.getByText(/Human agreement: pending/)).toBeTruthy();
  expect(screen.getByText(/Only a bounded slice/)).toBeTruthy();
  expect(screen.getByText(/simulated/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /agree/i })).toBeNull();
});
