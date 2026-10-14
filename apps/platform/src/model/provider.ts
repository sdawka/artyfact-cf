/** System One provider names in provenance may be a comma list (e.g. "fake,off"); `simulated` is the hosted demo's fake. */
export const isFakeProvider = (provider: unknown): boolean =>
  typeof provider === "string" && provider.split(",").some((p) => p.trim() === "fake" || p.trim() === "simulated");

export const FAKE_PROVIDER_TITLE =
  "System One ran on the fake provider (FAKE_S1=1): its judgments are canned and ignore the evidence. Rules-engine results are real.";
