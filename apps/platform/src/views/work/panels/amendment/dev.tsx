// Dev-only fixture page: `npm run dev -w @artyfact/platform`, then open
// /amendment-dev.html?scenario=deliberate|hard|review|fake|off|findings
// It is not part of the production build (nothing links to it).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import "@xyflow/react/dist/base.css";
import "@/theme/index.css";
import { fixtureBundle } from "@/api/fixtures";
import { qk, useModelBundle } from "@/api/queries";
import { ModelProvider } from "@/model/useModel";
import AmendmentReview from "../AmendmentReview";
import { candidate, COMMITMENT, EID, finding, judged, makeReview, readiness, realization, RID, SYSTEM_ID, CHANGED } from "./testData";

const scenario = new URLSearchParams(location.search).get("scenario") ?? "deliberate";

function review() {
  const hard = finding("error", "rule.no-engagement-metric", CHANGED, "Engagement is used as a measure of success");
  const old = finding("warning", "rule.purpose-needs-measure", "section.theory", "Purpose has no measure");
  switch (scenario) {
    case "hard":
      return makeReview({ review: [judged("hard-rule-violation", 0.95, { contradicts: { [COMMITMENT]: 0.92 } })], readinessBase: readiness([old]), readinessCandidate: readiness([hard]) });
    case "review":
      return makeReview({ review: [judged("deliberate-nonstandard-choice", 0.7, { contradicts: { [COMMITMENT]: 0.6 } })] });
    case "fake": {
      const r = judged("clarification", 0.95);
      r.provenance = { ...r.provenance, provider: "fake" };
      return makeReview({ review: [r] });
    }
    case "off": {
      const r = judged("clarification", 0.95, { changeClass: null, contradicts: {}, weakens: null, specificity: null, touchesConsent: null });
      r.provenance = { ...r.provenance, provider: "off" };
      return makeReview({ review: [r] });
    }
    case "findings":
      return makeReview({ readinessBase: readiness([old]), readinessCandidate: readiness([hard]) });
    default:
      return makeReview({ readinessBase: readiness([old]), readinessCandidate: readiness([]) });
  }
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
qc.setQueryData(qk.model(SYSTEM_ID, "head"), { ...fixtureBundle(), source: "api" });
qc.setQueryData(qk.amendmentReview(SYSTEM_ID, RID), review());

function Page() {
  const { data } = useModelBundle();
  if (!data) return null;
  return (
    <ModelProvider bundle={data}>
      <main style={{ padding: "var(--spacing-6)", maxInlineSize: "70rem" }}>
        <AmendmentReview systemId={SYSTEM_ID} evolutionId={EID} realization={realization} candidate={candidate} />
      </main>
    </ModelProvider>
  );
}

const router = createMemoryRouter([{ path: "/s/:systemId/r/:rev/work", element: <Page /> }], {
  initialEntries: [`/s/${SYSTEM_ID}/r/head/work`],
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
