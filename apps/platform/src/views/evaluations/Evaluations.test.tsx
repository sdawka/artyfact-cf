import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { chooseSelect } from "../testing/select";
import { SYSTEM, evaluation } from "../work/testData";

const URL = `/s/${SYSTEM}/r/head/evaluations`;
const seed = (evals: ReturnType<typeof evaluation>[]) => (qc: import("@tanstack/react-query").QueryClient) =>
  qc.setQueryData(qk.evaluations(SYSTEM, undefined), { evaluations: evals });

describe("Evaluations view", () => {
  it("says nothing is known when there are no evaluations, with no passing badge", async () => {
    renderApp(URL);
    expect(await screen.findByText("No evaluations yet — nothing is known")).toBeTruthy();
    expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
  });

  it("filters by verdict and candidate", async () => {
    renderApp(URL, undefined, seed([
      evaluation({ id: "e1", candidate: "cand.1", criterion: "C.webapp.exists" }),
      evaluation({ id: "e2", candidate: "cand.2", criterion: "C.webapp.health", verdict: "fail" }),
      evaluation({ id: "e3", candidate: "cand.2", criterion: "C.webapp.screen.people", execution: "not-run", verdict: "pass" }),
    ]));
    await screen.findByRole("table");
    expect(screen.getAllByRole("row")).toHaveLength(4);
    await chooseSelect(screen.getByRole("combobox", { name: "Verdict" }), "fail");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await chooseSelect(screen.getByRole("combobox", { name: "Verdict" }), "All");
    await chooseSelect(screen.getByRole("combobox", { name: "Candidate" }), "cand.1");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await chooseSelect(screen.getByRole("combobox", { name: "Execution" }), "error");
    expect(screen.getByText("No evaluations match these filters.")).toBeTruthy();
  });

  it("starts filtered to ?criterion=", async () => {
    renderApp(`${URL}?criterion=C.webapp.health`, undefined, seed([
      evaluation({ id: "e1", criterion: "C.webapp.exists" }),
      evaluation({ id: "e2", criterion: "C.webapp.health", verdict: "fail" }),
    ]));
    await screen.findByRole("table");
    expect(screen.getByRole("combobox", { name: "Criterion" }).textContent).toContain("C.webapp.health");
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("tags rows whose provenance provider includes fake, and only those", async () => {
    renderApp(URL, undefined, seed([
      evaluation({ id: "e1", criterion: "C.webapp.exists", provenance: { engine: "system-one", provider: "fake,off" } }),
      evaluation({ id: "e2", criterion: "C.webapp.health", provenance: { engine: "system-one", provider: "typesafe" } }),
    ]));
    await screen.findByRole("table");
    const tags = screen.getAllByText("fake");
    expect(tags).toHaveLength(1);
    expect(within(tags[0]!.closest("tr")!).getByRole("button", { name: "Expand evaluation e1" })).toBeTruthy();
    expect(tags[0]!.getAttribute("title")).toMatch(/fake provider/);
  });

  it("shows the error of a failed run in the row and in the detail", async () => {
    renderApp(URL, undefined, seed([evaluation({ execution: "error", verdict: "unknown", error: "hook timed out after 60000 ms" })]));
    await screen.findByRole("table");
    expect(screen.getAllByText("hook timed out after 60000 ms")).toHaveLength(1);
    expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand evaluation eval.1" }));
    expect(screen.getAllByText("hook timed out after 60000 ms")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Error" })).toBeTruthy();
  });

  it("never shows a not-run evaluation as pass", async () => {
    renderApp(URL, undefined, seed([evaluation({ execution: "not-run", verdict: "pass" })]));
    await screen.findByRole("table");
    expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
    expect(document.querySelector('[data-verdict="not-run"]')).not.toBeNull();
  });

  it("expands a row to the full evaluation and syncs ?evaluation=", async () => {
    const { router } = renderApp(URL, undefined, seed([evaluation()]));
    fireEvent.click(await screen.findByRole("button", { name: "Expand evaluation eval.1" }));
    for (const h of ["Question", "Method", "Raw observations", "Interpretation", "Limitations", "Provenance"]) {
      expect(screen.getByRole("heading", { name: h })).toBeTruthy();
    }
    const method = screen.getByRole("region", { name: "Method" });
    expect(within(method).getByText("manifest")).toBeTruthy();
    expect(screen.getByText("1250 ms")).toBeTruthy();
    expect(screen.getByText("0.93")).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toContain("evaluation=eval.1"));
    fireEvent.click(screen.getByRole("button", { name: "Collapse evaluation eval.1" }));
    expect(screen.queryByRole("heading", { name: "Question" })).toBeNull();
  });
});
