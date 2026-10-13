import { describe, expect, it } from "vitest";
import type { BuildStatus } from "../../../shared/api";
import { cardSummary, needsYou, sortByAttention, type CardSummary } from "./signifiers";

const base: CardSummary = {
  systemId: "s", title: "S", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "",
};
const build = (status: BuildStatus) => ({ id: "b", status, kind: "preview" as const, commit: "c" });

describe("cardSummary headline", () => {
  it("is quiet for a summary from a server without iteration-2 fields", () => {
    expect(cardSummary(base)).toMatchObject({ headline: "quiet", tone: "quiet" });
    expect(cardSummary(base).reviewHref).toBeUndefined();
    expect(cardSummary(base).deploy).toMatchObject({ label: "not deployed, unknown", tone: "neutral" });
  });

  it("puts attention before evolving before not built", () => {
    expect(cardSummary({ ...base, signifiers: ["not-fully-built"] })).toMatchObject({ headline: "not built", tone: "unbuilt" });
    const evolving = cardSummary({ ...base, signifiers: ["evolving", "not-fully-built"], realizationCounts: { evolving: 2, pending: 0, awaitingAdmin: 0 } });
    expect(evolving).toMatchObject({ headline: "2 realizations evolving", tone: "evolving" });
    const attention = cardSummary({ ...base, systemId: "system.x", signifiers: ["evolving", "awaiting-admin", "not-fully-built"], realizationCounts: { evolving: 2, pending: 0, awaitingAdmin: 3 } });
    expect(attention).toMatchObject({ headline: "3 await your review", tone: "attention", reviewHref: "/s/system.x/r/head/review" });
  });

  it("pluralises and tolerates missing counts", () => {
    expect(cardSummary({ ...base, signifiers: ["awaiting-admin"], realizationCounts: { evolving: 0, pending: 0, awaitingAdmin: 1 } }).headline).toBe("1 awaits your review");
    expect(cardSummary({ ...base, signifiers: ["evolving"], realizationCounts: { evolving: 1, pending: 0, awaitingAdmin: 0 } }).headline).toBe("1 realization evolving");
    expect(cardSummary({ ...base, signifiers: ["evolving"] }).headline).toBe("evolving");
    expect(cardSummary({ ...base, signifiers: ["awaiting-admin"] }).headline).toBe("awaiting your review");
  });

  it("reads deploy trouble on a quiet System as attention, without changing the headline", () => {
    expect(cardSummary({ ...base, deployState: "failed" })).toMatchObject({ headline: "quiet", tone: "quiet", state: "attention" });
    expect(cardSummary({ ...base, deployState: "behind" }).state).toBe("attention");
    expect(cardSummary({ ...base, deployState: "live" }).state).toBe("quiet");
  });

  it("does not show observed", () => {
    expect(cardSummary({ ...base, signifiers: ["observed"] }).headline).toBe("quiet");
  });
});

describe("cardSummary deploy line", () => {
  it("maps deploy states to tones", () => {
    const d = (deployState: CardSummary["deployState"]) => cardSummary({ ...base, deployState }).deploy;
    expect(d("live")).toMatchObject({ glyph: "●", label: "deployed", tone: "neutral" });
    expect(d("behind")).toMatchObject({ glyph: "●", label: "deployed, behind", tone: "attention" });
    expect(d("failed")).toMatchObject({ glyph: "×", label: "deploy failed", tone: "fail" });
    expect(d("pending")).toMatchObject({ label: "deploying", tone: "neutral" });
    expect(d("none")).toMatchObject({ label: "not deployed, unknown", tone: "neutral" });
  });

  it("folds the build in; only a passed build is success", () => {
    const line = (deployState: CardSummary["deployState"], status: BuildStatus) => cardSummary({ ...base, deployState, latestBuild: build(status) }).deploy;
    expect(line("live", "passed")).toMatchObject({ tone: "neutral", build: { label: "build passed", tone: "pass" } });
    expect(line("live", "running")).toMatchObject({ tone: "neutral", build: { label: "build running", tone: "neutral" } });
    expect(line("live", "failed").build).toMatchObject({ tone: "fail" });
    expect(line("none", "passed").tone).toBe("neutral");
    expect(line("failed", "passed").tone).toBe("fail");
    expect(cardSummary({ ...base, deployState: "live" }).deploy.build).toBeUndefined();
  });
});

describe("sortByAttention", () => {
  it("orders attention, then evolving, then newest update", () => {
    const sys = (id: string, signifiers: CardSummary["signifiers"], updatedAt: string): CardSummary => ({ ...base, systemId: id, signifiers, updatedAt });
    const list = [
      sys("quiet-new", [], "2026-10-12T10:00:00Z"),
      sys("evolving-old", ["evolving"], "2026-10-01T00:00:00Z"),
      sys("attention-old", ["awaiting-admin"], "2026-09-01T00:00:00Z"),
      sys("evolving-new", ["evolving"], "2026-10-10T00:00:00Z"),
      sys("quiet-old", [], "2026-10-02T00:00:00Z"),
    ];
    expect(sortByAttention(list).map((s) => s.systemId)).toEqual(["attention-old", "evolving-new", "evolving-old", "quiet-new", "quiet-old"]);
    expect(list[0]!.systemId).toBe("quiet-new");
    const troubled = [sys("quiet-new", [], "2026-10-12T10:00:00Z"), { ...sys("behind-old", [], "2026-09-01T00:00:00Z"), deployState: "behind" as const }];
    expect(sortByAttention(troubled).map((s) => s.systemId)).toEqual(["behind-old", "quiet-new"]);
  });
});

describe("needsYou", () => {
  it("lists one row per pending decision across Systems", () => {
    const rows = needsYou([
      { ...base, systemId: "a", title: "Alpha", signifiers: ["awaiting-admin"], realizationCounts: { evolving: 0, pending: 0, awaitingAdmin: 2 }, deployState: "behind" },
      { ...base, systemId: "b", title: "Beta", deployState: "failed" },
      { ...base, systemId: "c", title: "Gamma", deployState: "live" },
      { ...base, systemId: "d", title: "Delta", signifiers: ["awaiting-admin"], realizationCounts: { evolving: 0, pending: 0, awaitingAdmin: 1 } },
    ]);
    expect(rows.map((r) => [r.title, r.text, r.href])).toEqual([
      ["Alpha", "2 candidates await review", "/s/a/r/head/review"],
      ["Alpha", "deployed, behind", "/s/a/r/head/phenome"],
      ["Beta", "deploy failed", "/s/b/r/head/phenome"],
      ["Delta", "1 candidate awaits review", "/s/d/r/head/review"],
    ]);
  });

  it("is empty when nothing is waiting", () => {
    expect(needsYou([base, { ...base, deployState: "live" }])).toEqual([]);
  });
});

describe("task and import signifiers", () => {
  const sys = (o: Partial<CardSummary>): CardSummary => ({ ...base, systemId: "system.x", title: "X", ...o });
  const counts = (o: Partial<NonNullable<CardSummary["taskCounts"]>>) => ({ planReady: 0, awaitingAgent: 0, running: 0, blocked: 0, ...o });

  it("headlines each in precedence order", () => {
    const all = sys({
      signifiers: ["awaiting-admin", "import-pending", "task-awaiting-agent", "plan-ready", "wave-running", "evolving", "not-fully-built"],
      realizationCounts: { evolving: 1, pending: 0, awaitingAdmin: 2 }, taskCounts: counts({ awaitingAgent: 2, planReady: 1 }),
    });
    expect(cardSummary(all).headline).toBe("2 await your review");
    const noReview = { ...all, signifiers: all.signifiers!.filter((s) => s !== "awaiting-admin") };
    expect(cardSummary(noReview)).toMatchObject({ headline: "import awaits review", tone: "attention", reviewHref: "/s/system.x/r/head/review" });
    const noImport = { ...noReview, signifiers: noReview.signifiers!.filter((s) => s !== "import-pending") };
    expect(cardSummary(noImport)).toMatchObject({ headline: "2 tasks await an agent", tone: "attention", workHref: "/s/system.x/r/head/work" });
    const noTasks = { ...noImport, signifiers: noImport.signifiers!.filter((s) => s !== "task-awaiting-agent") };
    expect(cardSummary(noTasks)).toMatchObject({ headline: "a plan is ready", tone: "attention", workHref: "/s/system.x/r/head/work" });
    const noPlan = { ...noTasks, signifiers: noTasks.signifiers!.filter((s) => s !== "plan-ready") };
    expect(cardSummary(noPlan)).toMatchObject({ headline: "wave running", tone: "evolving" });
    expect(cardSummary({ ...noPlan, signifiers: ["evolving"] }).headline).toBe("1 realization evolving");
  });

  it("reads a pending importReview without the signifier", () => {
    expect(cardSummary(sys({ importReview: { status: "pending", genomeCommit: "g", nodes: 3 } })).headline).toBe("import awaits review");
    expect(cardSummary(sys({ importReview: { status: "accepted", genomeCommit: "g", nodes: 3 } })).headline).toBe("quiet");
  });

  it("has no work link for a quiet System", () => expect(cardSummary(base).workHref).toBeUndefined());

  it("adds ledger rows linking to review and work", () => {
    const rows = needsYou([sys({ title: "Peopling", signifiers: ["import-pending", "task-awaiting-agent", "plan-ready"], taskCounts: counts({ awaitingAgent: 2, planReady: 1 }) })]);
    expect(rows.map((r) => [`${r.title} · ${r.text}`, r.href])).toEqual([
      ["Peopling · import awaits review", "/s/system.x/r/head/review"],
      ["Peopling · 2 tasks await an agent", "/s/system.x/r/head/work"],
      ["Peopling · a plan is ready", "/s/system.x/r/head/work"],
    ]);
    expect(rows.every((r) => r.tone === "attention")).toBe(true);
  });
});
