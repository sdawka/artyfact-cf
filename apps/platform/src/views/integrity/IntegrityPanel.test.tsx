import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const { restartMutate } = vi.hoisted(() => ({ restartMutate: vi.fn() }));
vi.mock("@/api/queries", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/api/queries")>()), useStartIntegrity: () => ({ mutate: restartMutate, isPending: false }) }));
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

it("restarts completed checks with the original requested ceiling and thresholds", async () => {
  restartMutate.mockReset();
  const report={version:1,id:"report.pass",systemId:"system.demo",snapshotHash:"sha256:s",policyVersion:"integrity.v1",createdAt:"2026-10-14T00:00:00Z",status:"passed",structural:{status:"passed",complete:true,findings:[],limitations:[],checkedSubjects:["system.demo"],checkedRelationships:[]},semantic:{status:"passed",complete:true,intentFidelity:"checked",findings:[],limitations:[],checkedSubjects:["system.demo"],checkedRelationships:[],provenance:{provider:"test-real",model:"test-model",questions:["node.kind"],thresholds:{confident:0.9,review:0.5},budget:{requestedCalls:200,maxCalls:500,usedCalls:1},truncated:false,fake:false,retries:0}}};
  const run={id:"run.pass",systemId:"system.demo",snapshotId:"snapshot",snapshotHash:"sha256:s",provider:"clef",model:"original-model",requestedCalls:37,thresholds:{confident:.81,review:.41},attempt:1,state:"completed",createdAt:"",updatedAt:"",reviewUrl:"/review",report} as any;
  const router=createMemoryRouter([{path:"/s/:systemId/r/:rev/work",element:<IntegrityPanel run={run}/> }],{initialEntries:["/s/system.demo/r/head/work"]});
  render(<QueryClientProvider client={testQueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
  expect(await screen.findByRole("button",{name:"Record agreement"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Run check again" }));
  expect(restartMutate).toHaveBeenCalledWith({body:{snapshotId:"snapshot",provider:"clef",model:"original-model",thresholds:{confident:.81,review:.41},budget:{maxCalls:37},rerun:true}});
  expect(screen.getByText("Evidence and coverage")).toBeTruthy();
});

it("retries failed reportless checks with the original requested ceiling and thresholds", () => {
  restartMutate.mockReset();
  const run = {id:"run.failed",systemId:"system.demo",snapshotId:"snapshot.failed",snapshotHash:"sha256:s",provider:"off",requestedCalls:37,thresholds:{confident:.72,review:.22},attempt:1,state:"failed",createdAt:"",updatedAt:"",reviewUrl:"/review",error:{code:"transport",message:"offline"}} as any;
  const router=createMemoryRouter([{path:"/s/:systemId/r/:rev/work",element:<IntegrityPanel run={run}/> }],{initialEntries:["/s/system.demo/r/head/work"]});
  render(<QueryClientProvider client={testQueryClient()}><RouterProvider router={router}/></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", {name:"Retry check"}));
  expect(restartMutate).toHaveBeenCalledWith({body:{snapshotId:"snapshot.failed",provider:"off",thresholds:{confident:.72,review:.22},budget:{maxCalls:37},rerun:true}});
});
