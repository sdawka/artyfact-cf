// The Task fork model in Review (docs/design/task-fork-model.md, "Review view"): evidence grouped by layer, a
// candidate's proposed model change with System One's judgments, and the plan promotion's explicit model acceptance.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";
import { ADMIN_TOKEN_KEY } from "@/api/adminToken";
import { seed } from "../work/testSeed";
import { attempt, makePlan, task } from "../work/plan/testPlan";
import { SYSTEM, candidate, realization } from "../work/testData";

const base = `/s/${SYSTEM}/r/head`;
const GENOME = "a".repeat(40);
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

const provenance = (provider: string, error?: { message: string }) => ({ provider, model: provider === "off" ? "none" : "jev", questionHash: "q", stateHash: "s", thresholds: {}, ms: 1, usage: { input_tokens: 0, output_tokens: 0 }, ...(error && { error }) });
const judgment = (id: string, verdict: string, provider: string, error?: { message: string }) => ({ id, changeClass: null, contradicts: {}, weakens: null, specificity: null, touchesConsent: null, level: verdict === "fail" ? "error" : "info", verdict, provenance: provenance(provider, error) });

/** A submitted Task whose candidate changed `system/`: one node in scope, one added outside the write nodes. */
function taskApi() {
  const plan = makePlan({ tasks: [task("t1", { status: "submitted", writeNodes: ["screen.exact"], attempts: [attempt({ status: "submitted" })] })] });
  const model = {
    prefix: "system", genomeCommit: GENOME, changedPaths: ["system/things/webapp/screen.exact/node.yaml", "system/things/webapp/screen.new/node.yaml"], changedNodes: ["screen.exact", "screen.new"],
    delta: { added: ["screen.new"], removed: [], changed: [{ id: "screen.exact", fields: ["purpose"] }], affectedCriteria: [], affectedJourneys: [] },
    review: {
      delta: { changes: [{ id: "screen.exact", kind: "screen", before: {}, after: {}, fieldsChanged: ["purpose"] }, { id: "screen.new", kind: "screen", before: null, after: {}, fieldsChanged: [] }] },
      readinessBase: { findings: [] }, readinessCandidate: { findings: [] }, evaluations: [],
      review: [judgment("screen.exact", "pass", "typesafe"), judgment("screen.new", "unknown", "off")],
    },
  };
  const entry = {
    candidate: candidate({ id: "candidate.model", realization: "r.1", changedPaths: ["src/exact.ts"], changedSubjects: ["screen.exact"], model: model as unknown as NonNullable<ReturnType<typeof candidate>["model"]> }),
    manifest: { planId: plan.id, taskId: "t1", realizationId: "r.1", repo: "fork", baseRepo: "web", baseCommit: "pinned-base", commit: "model-commit", manifestHash: "hash", changedPaths: ["src/exact.ts"] },
    evaluations: [
      { id: "e.run", criterion: "C.run", verdict: "unknown", execution: "completed" },
      { id: "e.code", criterion: "C.exact", verdict: "pass", execution: "completed" },
      { id: "e.model", criterion: "C.model-review", verdict: "fail", execution: "completed" },
      { id: "e.none", criterion: "C.unplaced", verdict: "unknown", execution: "not-run" },
    ],
    model,
  };
  const layers = { "C.run": "phenome", "C.exact": "realization", "C.model-review": "genome" };
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/api/systems")) return Response.json([{ systemId: SYSTEM, title: "System", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "", planCounts: { open: 1, awaitingAgent: 0, submitted: 1, integrated: 0 } }]);
    if (url.endsWith("/realization-plans")) return Response.json({ plans: [plan] });
    if (url.includes("/review/files")) return Response.json({ from: { repo: "genome", commit: GENOME, text: "purpose: before" }, to: { repo: "fork", commit: "model-commit", text: "purpose: after" }, binary: false, truncated: false });
    if (url.endsWith("/tasks/t1/review")) return Response.json({ plan, task: plan.tasks[0], candidates: [entry], layers });
    if (url.includes("/realization-plans/")) return Response.json(plan);
    return Response.json({});
  }));
  sessionStorage.setItem(ADMIN_TOKEN_KEY, "admin");
  // The checkpoint reason comes from the board's realization (the review DTO carries none).
  return { calls, setup: seed({ api: true, realizations: [realization({ id: "r.1", status: "working", checkpoints: [{ at: "", summary: "The Genome names no screen for the exact view; added screen.new.", commit: "model-commit" }] })] }) };
}

it("groups recorded evaluations by layer in Model, Realization, Running thing order and keeps unplaced rows last", async () => {
  const a = taskApi(); renderApp(`${base}/review?plan=plan.one&task=t1`, undefined, a.setup);
  const review = await screen.findByRole("region", { name: "Review Task t1" });
  const candidateRegion = within(review).getByRole("article", { name: "Candidate candidate.model" });
  const evidence = within(candidateRegion).getAllByRole("region", { name: /^(Model|Realization|Running thing|Layer unknown)$/ });
  expect(evidence.map((s) => s.getAttribute("data-layer"))).toEqual(["genome", "realization", "phenome", "unknown"]);
  expect(evidence[0]!.textContent).toMatch(/Model.*the model exists and is consistent.*C\.model-review: fail/);
  expect(evidence[2]!.textContent).toMatch(/Running thing.*C\.run: unknown/);
  expect(evidence[3]!.textContent).toMatch(/C\.unplaced: unknown \(not-run\)/);
  // Only pass is green; unknown is neutral; fail is danger.
  const tones = [...candidateRegion.querySelectorAll<HTMLElement>("[data-layer] [data-status]")].map((s) => `${s.dataset.status}:${s.dataset.tone}`);
  expect(tones).toEqual(["fail:fail", "pass:pass", "unknown:neutral", "unknown:neutral"]);
});

it("shows the model change proposed by the agent: files, nodes against the write nodes, System One judgments and the checkpoint reason", async () => {
  const a = taskApi(); renderApp(`${base}/review?plan=plan.one&task=t1`, undefined, a.setup);
  const review = await screen.findByRole("region", { name: "Review Task t1" });
  const change = within(review).getByRole("region", { name: "Model change proposed by the agent" });
  expect(change.textContent).toContain("system/");
  expect(within(change).getByTitle(GENOME).textContent).toBe(GENOME.slice(0, 7));
  // Nodes: the changed one is in scope; the added one is flagged against the Task's write nodes (attention, not danger).
  expect(within(change).getAllByTitle("Screen: screen.exact")).toHaveLength(2);
  const outside = within(change).getAllByText("outside this Task's write nodes");
  expect(outside).toHaveLength(1);
  expect(outside[0]!.closest("li")!.textContent).toContain("screen.new");
  expect(outside[0]!.closest("[data-status]")!.getAttribute("data-tone")).toBe("attention");
  expect(change.textContent).toContain("changed: purpose");
  // Judgments follow the delta (added, changed, removed): pass is green, unknown reads "not judged" with the provider's reason.
  const judgments = [...change.querySelectorAll<HTMLElement>("li[data-verdict]")];
  expect(judgments.map((j) => j.dataset.verdict)).toEqual(["unknown", "pass"]);
  expect(judgments[1]!.querySelector("[data-status='pass']")!.getAttribute("data-tone")).toBe("pass");
  expect(judgments[0]!.textContent).toMatch(/screen\.new.*not judged.*System One off/);
  expect(judgments[0]!.querySelector("[data-status='unknown']")!.getAttribute("data-tone")).toBe("neutral");
  expect(change.textContent).toMatch(/level\s*info/);
  expect(change.textContent).toContain("The Genome names no screen for the exact view; added screen.new.");
  // A changed model file opens the same compare route as a code file.
  fireEvent.click(within(change).getByRole("button", { name: "system/things/webapp/screen.new/node.yaml" }));
  await waitFor(() => expect(a.calls.some((c) => c.url.includes("/review/files") && c.url.includes("candidateId=candidate.model") && c.url.includes(encodeURIComponent("system/things/webapp/screen.new/node.yaml")))).toBe(true));
  expect(await within(review).findByText("purpose: after")).toBeTruthy();
});

it("says when System One did not review the change and when the candidate's model does not load", async () => {
  const a = taskApi();
  const real = globalThis.fetch as unknown as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await real(input, init);
    if (!String(input).endsWith("/tasks/t1/review")) return res;
    const body = await res.json();
    const entry = body.candidates[0];
    entry.model = { ...entry.model, review: null, loadError: "YAML parse error in screen.new/node.yaml", delta: { added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] } };
    return Response.json(body);
  }));
  renderApp(`${base}/review?plan=plan.one&task=t1`, undefined, a.setup);
  const change = await screen.findByRole("region", { name: "Model change proposed by the agent" });
  expect(within(change).getByRole("alert").textContent).toMatch(/does not load: YAML parse error.*not because nothing changed/);
  expect(within(change).getByText("Not judged: System One did not review this change.")).toBeTruthy();
  // changedNodes still lists what changed when the semantic delta is empty.
  expect(within(change).getByTitle(/screen\.exact$/)).toBeTruthy();
  expect(change.querySelector("[data-tone='pass']")).toBeNull();
});

/** An integrated plan whose integrated commit carries a model delta. */
function planApi(options: { modelDelta?: boolean } = {}) {
  const plan = makePlan({ status: "integrated", tasks: [] });
  const model = { prefix: "system", genomeCommit: GENOME, changedPaths: ["system/things/webapp/screen.new/node.yaml"], changedNodes: ["screen.new"], delta: { added: ["screen.new"], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] } };
  const source = { repo: "web--integration", commit: "b".repeat(40) };
  const review = {
    plan, bindings: [{ artifactId: "artifact.web", source, candidateId: "cand.int", taskCandidates: ["candidate.model"], realizedGenome: GENOME, ...(options.modelDelta !== false && { model }) }],
    candidates: [], evaluations: [{ id: "e.model", criterion: "C.model-review", verdict: "unknown", execution: "completed" }, { id: "e.code", criterion: "C.exact", verdict: "pass", execution: "completed" }],
    ready: true, blockers: [], expectedHead: "sc-1", layers: { "C.model-review": "genome", "C.exact": "realization" },
    ...(options.modelDelta !== false && { modelDelta: { source, model } }),
  };
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/promote")) return Response.json({ plan: { ...plan, status: "promoted" }, commit: { id: "sc-2" } });
    if (url.endsWith("/review")) return Response.json(review);
    if (url.endsWith("/realization-plans")) return Response.json({ plans: [plan] });
    if (url.includes("/realization-plans/")) return Response.json(plan);
    return Response.json({});
  }));
  sessionStorage.setItem(ADMIN_TOKEN_KEY, "admin");
  return { calls, setup: seed({ api: true, realizations: [] }) };
}

it("requires an explicit Accept the model change before promoting an integrated model delta, then sends acceptModelDelta", async () => {
  const a = planApi(); renderApp(`${base}/review?plan=plan.one`, undefined, a.setup);
  const delta = await screen.findByRole("region", { name: "Model change in the integrated result" });
  expect(delta.textContent).toContain("system/");
  expect(within(delta).getByTitle(/screen\.new$/)).toBeTruthy();
  expect(within(delta).getByRole("button", { name: "system/things/webapp/screen.new/node.yaml" })).toBeTruthy();
  // Evaluations are grouped by layer here too.
  expect([...screen.getByRole("region", { name: "Model" }).parentElement!.querySelectorAll("[data-layer]")].map((s) => s.getAttribute("data-layer"))).toEqual(["genome", "realization"]);
  // The button remounts when its reason goes away, so it is re-queried after each change.
  const promote = () => screen.getByRole("button", { name: "Promote reviewed implementation" });
  fireEvent.change(screen.getByLabelText("Promotion rationale"), { target: { value: "Accepting the screen the agent found missing." } });
  expect(promote().hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("Accept the model change to promote it.")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /Accept the model change/ }));
  await waitFor(() => expect(promote().hasAttribute("disabled")).toBe(false));
  expect(screen.queryByText("Accept the model change to promote it.")).toBeNull();
  fireEvent.click(promote());
  await waitFor(() => expect(a.calls.find((c) => c.url.endsWith("/promote"))?.body).toEqual({ expectedHead: "sc-1", rationale: "Accepting the screen the agent found missing.", candidateIds: ["cand.int"], acceptModelDelta: true }));
});

it("promotes without the checkbox and without acceptModelDelta when no task changed the model", async () => {
  const a = planApi({ modelDelta: false }); renderApp(`${base}/review?plan=plan.one`, undefined, a.setup);
  const promote = () => screen.getByRole("button", { name: "Promote reviewed implementation" });
  await screen.findByRole("button", { name: "Promote reviewed implementation" });
  expect(screen.queryByRole("region", { name: "Model change in the integrated result" })).toBeNull();
  expect(screen.queryByRole("checkbox", { name: /Accept the model change/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Promotion rationale"), { target: { value: "Code only." } });
  await waitFor(() => expect(promote().hasAttribute("disabled")).toBe(false));
  fireEvent.click(promote());
  await waitFor(() => expect(a.calls.find((c) => c.url.endsWith("/promote"))?.body).toEqual({ expectedHead: "sc-1", rationale: "Code only.", candidateIds: ["cand.int"] }));
});
