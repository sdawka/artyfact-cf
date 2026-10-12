import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { vi, describe, expect, it } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { fixtureBundle } from "@/api/fixtures";
import { qk, useModelBundle } from "@/api/queries";
import { ModelProvider } from "@/model/useModel";
import { renderApp } from "@/testing/render";
import AmendmentReview from "./AmendmentReview";
import { diffReadiness } from "./amendment/diffReadiness";
import {
  candidate, EID, finding, judged, makeReview, readiness, realization, RID, SYSTEM_ID, CHANGED, COMMITMENT,
} from "./amendment/testData";
import type { GenomeCandidateReview } from "../../../../shared/api";

function Harness() {
  const { data } = useModelBundle();
  if (!data) return null;
  return (
    <ModelProvider bundle={data}>
      <AmendmentReview systemId={SYSTEM_ID} evolutionId={EID} realization={realization} candidate={candidate} />
    </ModelProvider>
  );
}
const routes = [{ path: "/s/:systemId/r/:rev/work", element: <Harness /> }];
const URL = `/s/${SYSTEM_ID}/r/head/work`;

/** `live` marks the bundle as coming from the API so accept is not disabled by fixture mode. */
function renderReview(review: GenomeCandidateReview, { live = true }: { live?: boolean } = {}) {
  return renderApp(URL, routes, (qc: QueryClient) => {
    qc.setQueryData(qk.amendmentReview(SYSTEM_ID, RID), review);
    if (live) qc.setQueryData(qk.model(SYSTEM_ID, "head"), { ...fixtureBundle(), source: "api" });
  });
}

const userEvent = {
  click: async (el: Element) => void fireEvent.click(el),
  clear: async (el: Element) => void fireEvent.change(el, { target: { value: "" } }),
  type: async (el: Element, value: string) => void fireEvent.change(el, { target: { value } }),
  setup() { return userEvent; },
};
const hardFinding = finding("error", "rule.no-engagement-metric", CHANGED, "Engagement is used as a measure");
const signals = () => screen.getByRole("region", { name: /System One signals/i });

describe("diffReadiness", () => {
  it("computes resolved (base - candidate) and added (candidate - base)", () => {
    const kept = finding("warning", "r.kept", "a", "kept");
    const gone = finding("error", "r.gone", "b", "gone");
    const fresh = finding("error", "r.fresh", "c", "fresh");
    const d = diffReadiness(readiness([kept, gone]), readiness([kept, fresh]));
    expect(d.resolved.map((f) => f.rule)).toEqual(["r.gone"]);
    expect(d.added.map((f) => f.rule)).toEqual(["r.fresh"]);
    expect(d.hardAdded.map((f) => f.rule)).toEqual(["r.fresh"]);
  });
  it("treats the same rule on another subject as different", () => {
    const d = diffReadiness(readiness([finding("info", "r", "a", "m")]), readiness([finding("info", "r", "b", "m")]));
    expect(d.resolved).toHaveLength(1);
    expect(d.added).toHaveLength(1);
    expect(d.hardAdded).toHaveLength(0);
  });
});

describe("AmendmentReview", () => {
  it("shows the header and the semantic delta with a field diff", async () => {
    renderReview(makeReview());
    expect(await screen.findByRole("heading", { name: /Genome amendment/i })).toBeTruthy();
    expect(screen.getByText("awaiting admin")).toBeTruthy();
    expect(screen.getByText(/agent\.drafter/)).toBeTruthy();
    expect(screen.getByText(/a1b2c3d/)).toBeTruthy();
    expect(screen.getByText(/9f8e7d6/)).toBeTruthy();
    const delta = screen.getByRole("region", { name: /Semantic delta/i });
    expect(within(delta).getByText(/changed/i)).toBeTruthy();
    expect(within(delta).getByText("description")).toBeTruthy();
    expect(within(delta).getByText("Why the System exists.")).toBeTruthy();
    expect(within(delta).getAllByText(/deliberately has no feed/).length).toBeGreaterThan(0);
  });

  it("flags a hard rule p=0.95 as an error row and disables accept", async () => {
    renderReview(makeReview({ review: [judged("hard-rule-violation", 0.95)] }));
    await screen.findByRole("region", { name: /System One signals/i });
    const row = within(signals()).getByText(/model flagged; admin decides/i);
    expect(row.closest("[data-tone]")?.getAttribute("data-tone")).toBe("fail");
    expect((screen.getByRole("button", { name: /^accept/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/hard violation/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^reject/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/deliberate choice — no rule violated/i)).toBeNull();
  });

  it("shows a calm line for a deliberate choice p=0.93 with no hard findings, and accept is enabled and prefilled", async () => {
    renderReview(makeReview());
    expect(await screen.findByText(/deliberate choice — no rule violated/i)).toBeTruthy();
    expect(within(signals()).queryByText(/model flagged/i)).toBeNull();
    const ta = screen.getByRole("textbox", { name: /accepted interpretation/i }) as HTMLTextAreaElement;
    expect(ta.value).toMatch(/deliberately has no feed/);
    expect((screen.getByRole("button", { name: /^accept/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not show the calm line when a hard finding was added", async () => {
    renderReview(makeReview({ readinessCandidate: readiness([hardFinding]) }));
    await screen.findByRole("region", { name: /System One signals/i });
    expect(screen.queryByText(/deliberate choice — no rule violated/i)).toBeNull();
    expect(screen.getByText(/blocks acceptance/i).textContent).toMatch(/rule\.no-engagement-metric/);
    expect((screen.getByRole("button", { name: /^accept/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("at p=0.7 labels the top class review and nothing in the signals is green", async () => {
    renderReview(makeReview({ review: [judged("deliberate-nonstandard-choice", 0.7, { contradicts: { [COMMITMENT]: 0.6 } })] }));
    await screen.findByRole("region", { name: /System One signals/i });
    const s = signals();
    expect(within(s).getByText("review")).toBeTruthy();
    expect(s.querySelectorAll('[data-tone="pass"]').length).toBe(0);
    expect(s.querySelector('[data-top="true"]')).toBeNull();
    expect(screen.queryByText(/deliberate choice — no rule violated/i)).toBeNull();
    expect(within(s).getByText("0.70")).toBeTruthy();
    expect(within(s).getByText("0.60")).toBeTruthy();
  });

  it("highlights the top class only at p>=0.9", async () => {
    renderReview(makeReview());
    await screen.findByRole("region", { name: /System One signals/i });
    expect(signals().querySelectorAll('[data-top="true"]').length).toBe(1);
    expect(within(signals()).getByText("0.93")).toBeTruthy();
  });

  it("shows contradicts with the commitment statement, weakens, specificity and consent", async () => {
    renderReview(makeReview());
    await screen.findByRole("region", { name: /System One signals/i });
    const s = signals();
    expect(within(s).getByText(/Theory supports the Purpose/)).toBeTruthy();
    expect(within(s).getByText("0.04")).toBeTruthy();
    expect(within(s).getByText(/weakens/i)).toBeTruthy();
    expect(within(s).getByText(/specificity/i)).toBeTruthy();
    expect(within(s).getByText(/touches consent/i)).toBeTruthy();
  });

  it("flags the fake provider and shows off as unknown", async () => {
    const fake = judged("clarification", 0.95, {});
    fake.provenance = { ...fake.provenance, provider: "fake" };
    const { unmount } = renderReview(makeReview({ review: [fake] }));
    await screen.findByRole("region", { name: /System One signals/i });
    expect(within(signals()).getByText(/fake provider/i)).toBeTruthy();
    unmount();

    const off = judged("clarification", 0.95, { changeClass: null, contradicts: {}, weakens: null, specificity: null, touchesConsent: null, verdict: "unknown" });
    off.provenance = { ...off.provenance, provider: "off" };
    renderReview(makeReview({ review: [off] }));
    await screen.findByRole("region", { name: /System One signals/i });
    expect(within(signals()).getByText(/off — unknown/i)).toBeTruthy();
    expect(signals().querySelectorAll('[data-tone="pass"]').length).toBe(0);
  });

  it("lists resolved and added findings with level, rule, subject and an expandable derivation", async () => {
    const resolved = finding("warning", "rule.old", "section.theory", "Old problem");
    renderReview(makeReview({ readinessBase: readiness([resolved]), readinessCandidate: readiness([hardFinding]) }));
    const diff = await screen.findByRole("region", { name: /Readiness diff/i });
    const [resolvedList, addedList] = [within(diff).getByRole("list", { name: /resolved/i }), within(diff).getByRole("list", { name: /added/i })];
    expect(within(resolvedList).getByText("rule.old")).toBeTruthy();
    expect(within(addedList).getByText("rule.no-engagement-metric")).toBeTruthy();
    const toggle = within(addedList).getByRole("button", { name: /derivation/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(addedList).getByText(/node\(section\.purpose\)/)).toBeTruthy();
  });

  it("requires an interpretation to accept and sends it, then shows the new commit and a map link", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/systems")) return Response.json([{ systemId: SYSTEM_ID, title: "Keep in Touch", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "x", evolutionCounts: {}, updatedAt: "now" }]);
      if (url.endsWith(`/evolutions/${EID}/accept`) && init?.method === "POST") return Response.json({ genomeCommit: "c0ffee1234567", realization });
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderReview(makeReview());
    const user = userEvent.setup();
    const ta = await screen.findByRole("textbox", { name: /accepted interpretation/i });
    await user.clear(ta);
    await user.click(screen.getByRole("button", { name: /^accept/i }));
    expect(screen.getByText(/interpretation is required/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/accept"), expect.anything());
    await user.type(ta, "No feed, by design.");
    await user.click(screen.getByRole("button", { name: /^accept/i }));
    expect(await screen.findByText(/c0ffee1/)).toBeTruthy();
    const body = JSON.parse(String(fetchMock.mock.calls.find(([u]) => String(u).endsWith("/accept"))![1]!.body));
    expect(body).toEqual({ realization: RID, rationale: "No feed, by design." });
    const link = screen.getByRole("link", { name: /open in map/i });
    expect(link.getAttribute("href")).toContain(`/map?`);
    expect(link.getAttribute("href")).toContain(`focus=${CHANGED}`);
  });

  it("requires a reason to reject", async () => {
    renderReview(makeReview({ review: [judged("hard-rule-violation", 0.95)] }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^reject/i }));
    expect(screen.getByText(/reason is required/i)).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: /rejection reason/i }), "Uses engagement as a measure.");
    await user.click(screen.getByRole("button", { name: /^reject/i }));
    await waitFor(() => expect(screen.getByText(/^rejected$/i)).toBeTruthy());
  });

  it("disables accept with a reason in fixture mode but keeps reject", async () => {
    renderReview(makeReview(), { live: false });
    await screen.findByRole("region", { name: /System One signals/i });
    expect((screen.getByRole("button", { name: /^accept/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/fixture data/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^reject/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});
