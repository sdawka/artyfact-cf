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
  it("says no evaluations yet, how they are recorded and where to go, with no passing badge", async () => {
    renderApp(URL);
    expect(await screen.findByText("No evaluations yet.")).toBeTruthy();
    expect(screen.getByText("They are recorded when a candidate is submitted or checks are re-run.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Review" })).toBeTruthy();
    expect(screen.queryByText(/nothing is known/)).toBeNull();
    expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
  });

  it("filters by verdict and candidate, in the URL, with a count and Clear filters", async () => {
    const { router } = renderApp(URL, undefined, seed([
      evaluation({ id: "e1", candidate: "cand.1", criterion: "C.webapp.exists" }),
      evaluation({ id: "e2", candidate: "cand.2", criterion: "C.webapp.health", verdict: "fail" }),
      evaluation({ id: "e3", candidate: "cand.2", criterion: "C.webapp.screen.people", execution: "not-run", verdict: "pass" }),
    ]));
    await screen.findByRole("table");
    // Two candidates: one group each, headed by the candidate and its verdict summary (header + 2 group heads + 3 rows).
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByRole("rowheader", { name: /cand\.2/ }).textContent).toMatch(/cand\.2.*× 1 fail · – 1 not-run/);
    expect(screen.getByRole("status").textContent).toBe("3 results");
    await chooseSelect(screen.getByRole("combobox", { name: "Verdict" }), "fail");
    // One candidate left: no groups.
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toBe("1 of 3 results");
    await waitFor(() => expect(router.state.location.search).toBe("?verdict=fail"));
    await chooseSelect(screen.getByRole("combobox", { name: "Verdict" }), "All");
    await chooseSelect(screen.getByRole("combobox", { name: "Candidate" }), "cand.1");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await chooseSelect(screen.getByRole("combobox", { name: "Execution" }), "error");
    expect(screen.getByText("No evaluations match these filters.")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]!);
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });

  it("starts filtered to ?criterion=", async () => {
    renderApp(`${URL}?criterion=C.webapp.health`, undefined, seed([
      evaluation({ id: "e1", criterion: "C.webapp.exists" }),
      evaluation({ id: "e2", criterion: "C.webapp.health", verdict: "fail" }),
    ]));
    await screen.findByRole("table");
    expect(screen.getByRole("combobox", { name: "Criterion" }).textContent).toContain("C.webapp.health");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText(/Showing evidence for/)).toBeTruthy();
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
    // Interpretation and Limitations first.
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Interpretation", "Limitations", "Question", "Method", "Raw observations", "Provenance"]);
    const method = screen.getByRole("region", { name: "Method" });
    expect(within(method).getByText("manifest")).toBeTruthy();
    expect(screen.getByText("1250 ms")).toBeTruthy();
    expect(screen.getByText("0.93")).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toContain("evaluation=eval.1"));
    // The whole row toggles, not only the chevron.
    fireEvent.click(screen.getByRole("button", { name: "Collapse evaluation eval.1" }).closest("tr")!.querySelector("td:nth-child(2)")!);
    expect(screen.queryByRole("heading", { name: "Question" })).toBeNull();
  });

  it("shows the criterion as plain text with its id, and the hook beside a duplicate title", async () => {
    renderApp(URL, undefined, seed([
      evaluation({ id: "e1", criterion: "C.webapp.exists", hook: "hook.a" }),
      evaluation({ id: "e2", criterion: "C.webapp.exists", hook: "hook.b", startedAt: "2026-01-01T00:00:00Z" }),
    ]));
    await screen.findByRole("table");
    const row = screen.getByRole("button", { name: "Expand evaluation e1" }).closest("tr")!;
    expect(row.querySelector("button[title^='Criterion']")).toBeNull();
    expect(within(row).getByText("C.webapp.exists")).toBeTruthy();
    expect(within(row).getAllByText("hook.a")).toHaveLength(2);
  });
});
