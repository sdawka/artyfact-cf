import type { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictReport } from "../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { PacketViewer } from "./panels/PacketViewer";
import { itemVerdict } from "./panels/PromotionPanel";
import { SYSTEM, candidate, realization } from "./testData";
import { EVO1, evalFor, json, seed } from "./testSeed";

const WORK = `/s/${SYSTEM}/r/head/work`;
afterEach(() => { vi.useRealTimers(); sessionStorage.clear(); });

describe("Work list and detail", () => {
  const groupOf = (key: string) => document.querySelector(`details[data-group="${key}"]`) as HTMLDetailsElement | null;

  it("groups the fixture Evolutions by state in one list pane, legacy last and collapsed", async () => {
    renderApp(WORK);
    const list = await screen.findByRole("region", { name: "Plans and Evolutions" });
    expect(within(list).getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(["Plans", "Evolutions"]);
    await waitFor(() => expect(groupOf("proposed")).toBeTruthy());
    expect(within(groupOf("proposed")!).getAllByRole("link")).toHaveLength(2);
    expect(within(groupOf("actionable")!).getAllByRole("link")).toHaveLength(1);
    expect(within(groupOf("legacy")!).getAllByRole("link")).toHaveLength(3);
    expect(groupOf("legacy")!.open).toBe(false);
    expect(groupOf("proposed")!.open).toBe(true);
    // Empty groups collapse to one line of labels with their 0 counts; nothing scrolls sideways.
    expect(groupOf("realizing")).toBeNull();
    expect(within(list).getByText(/Realizing/).textContent).toMatch(/Realizing\s*0/);
    expect(document.querySelector('[role="group"][aria-label="Evolution board"]')).toBeNull();
    const order = [...document.querySelectorAll("details[data-group]")].map((d) => d.getAttribute("data-group"));
    expect(order).toEqual(["proposed", "actionable", "legacy"]);
  });

  it("rows link with aria-current and carry the criteria rollup and the dependency as text", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`);
    const one = await screen.findByRole("link", { name: /^Private contact foundation/ });
    expect(one.getAttribute("aria-current")).toBe("true");
    expect(one.textContent).toMatch(/0\/7 pass/);
    expect(one.textContent).not.toMatch(/after/);
    const legacy = within(document.querySelector('details[data-group="legacy"]') as HTMLElement).getAllByRole("link");
    expect(legacy.some((c) => /after Private contact foundation/.test(c.textContent ?? ""))).toBe(true);
    expect(legacy.every((c) => !c.hasAttribute("aria-current"))).toBe(true);
  });

  it("never shows a not-run rollup as green", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`);
    await screen.findByRole("heading", { level: 2, name: /Private contact foundation/ });
    expect(document.querySelector('[data-tone="pass"]')).toBeNull();
    expect(document.querySelector('[data-status="not-run"]')).not.toBeNull();
  });

  it("selects the first item waiting on you on arrival (replace), and a row click opens its detail", async () => {
    const { router } = renderApp(WORK);
    // Nothing waits on review in the fixture: the actionable Evolution is the next step (Start work).
    await waitFor(() => expect(router.state.location.search).toBe(`?evolution=${EVO1}`));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByRole("heading", { level: 2, name: /Private contact foundation/ })).toBeTruthy();
    expect(screen.getByText("No one is working on this Evolution. Start work hands an agent its Task Packet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: /^Private digests/ }));
    await waitFor(() => expect(router.state.location.search).toBe("?evolution=evolution.5"));
    expect(await screen.findByRole("heading", { level: 2, name: /Private digests/ })).toBeTruthy();
  });

  it("detail: state-driven primary, MetaLine facts, compact criteria and the Start work reason on a proposed Evolution", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`);
    const detail = await screen.findByRole("region", { name: "Private contact foundation" });
    expect(within(detail).getByRole("button", { name: "Start work" }).getAttribute("data-variant")).toBe("primary");
    // The header's Describe a change turns secondary while the selection offers its own primary.
    expect(screen.getByRole("button", { name: "Describe a change" }).getAttribute("data-variant")).toBe("secondary");
    expect(within(detail).getByText("evolution.1").tagName).toBe("CODE");
    expect(within(detail).getByRole("list", { name: "Acceptance criteria" }).querySelectorAll("li")).toHaveLength(7);
    cleanup();
    renderApp(`${WORK}?evolution=evolution.5`);
    const five = await screen.findByRole("region", { name: "Private digests (later)" });
    const start = within(five).getByRole("button", { name: "Start work" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(within(five).getByText("evolution.5 is proposed; Start work needs actionable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Describe a change" }).getAttribute("data-variant")).toBe("primary");
  });

  it("redirects a ?realization= deep link to Review with every param", async () => {
    const { router } = renderApp(`${WORK}?evolution=${EVO1}&realization=realization.1#x`, undefined, seed({ realizations: [realization()] }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/${SYSTEM}/r/head/review`));
    expect(router.state.location.search).toBe(`?evolution=${EVO1}&realization=realization.1`);
    expect(router.state.location.hash).toBe("#x");
  });

  it("shows the header purpose and hides the waiting counts at zero", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`);
    expect(await screen.findByText("Genome Evolutions and the Task plans that realize them.")).toBeTruthy();
    expect(screen.queryByText(/await an agent|awaits review/)).toBeNull();
  });
});

describe("StartWorkPanel", () => {
  it("is disabled in fixture mode and says why", async () => {
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`);
    await screen.findByRole("heading", { name: /Start work on/ });
    const submit = screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText(/Start work needs the platform API/)).toBeTruthy();
    expect(submit.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("replaces the Attempts region with Back to Evolution", async () => {
    const { router } = renderApp(`${WORK}?evolution=${EVO1}&panel=start`);
    const heading = await screen.findByRole("heading", { level: 3, name: /Start work on/ });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryByRole("heading", { name: /^Legacy realizations|^Attempts/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to Evolution" }));
    await waitFor(() => expect(router.state.location.search).toBe(`?evolution=${EVO1}`));
    expect(await screen.findByRole("heading", { name: /^Legacy realizations/ })).toBeTruthy();
  });
});

describe("StartWorkPanel against the API", () => {
  it("submits, then shows the packet and the command once", async () => {
    const cli = "ARTYFACT_TOKEN=tok_x ARTYFACT_SECRET=sec_x npx artyfact start realization.9 --system system.peopling --evolution evolution.1 --dir ./realization.9";
    const calls: unknown[] = [];
    const auth: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/realization-plans")) return json(200, { plans: [] });
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST" && u.endsWith("/evolutions/evolution.1/realizations")) {
        calls.push(JSON.parse(String(init.body)));
        auth.push(new Headers(init.headers).get("authorization"));
        return json(201, { realization: realization({ id: "realization.9" }), packet: { json: {}, markdown: "# Task\n\n- build it" }, token: "tok_x", remote: "https://git/fork", cli });
      }
      return json(200, { evolutions: [], realizations: [] });
    }));
    sessionStorage.setItem("artyfact.adminToken", "adm_x");
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    fireEvent.change(await screen.findByLabelText("Agent label"), { target: { value: "codex-1" } });
    // The header owns the token: no per-form field.
    expect(screen.queryByLabelText("Admin token")).toBeNull();
    const submit = screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findAllByText(cli)).toHaveLength(1);
    expect(calls).toEqual([{ agentLabel: "codex-1", target: "app", role: "implementer" }]);
    expect(auth).toEqual(["Bearer adm_x"]);
    expect(screen.getByRole("heading", { name: "Task" })).toBeTruthy();
    expect(screen.getByText(/Neither is shown again/)).toBeTruthy();
  });

  it("without the header token the submit is disabled with the visible reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/realization-plans")) return json(200, { plans: [] });
      if (u.endsWith("/api/systems")) return json(200, []);
      return json(200, { evolutions: [], realizations: [] });
    }));
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    await screen.findByLabelText("Agent label");
    const submit = screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(document.getElementById(submit.getAttribute("aria-describedby")!)!.textContent).toBe("Set the admin token in the header.");
  });

  it.each([
    [401, /needs the admin token \(401\)/],
    [403, /admin token was refused \(403\)/],
  ])("says plainly when start work is refused with %i", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/realization-plans")) return json(200, { plans: [] });
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST") return json(status, { error: { code: status === 401 ? "unauthorized" : "forbidden", message: "nope" } });
      return json(200, { evolutions: [], realizations: [] });
    }));
    sessionStorage.setItem("artyfact.adminToken", "adm_x");
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    await screen.findByLabelText("Agent label");
    fireEvent.click(screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit")!);
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
  });
});

describe("PacketViewer without a command", () => {
  it("says the command is unavailable and never invents one", () => {
    render(<PacketViewer markdown="# T" cli={null} expiresAt="2026-01-01T01:00:00.000Z" />);
    expect(screen.getByText(/Command unavailable/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("npx artyfact");
  });
});

describe("PacketViewer", () => {
  const CLI = "ARTYFACT_TOKEN=tok_secret npx artyfact start realization.1 --system system.peopling --evolution evolution.1 --dir ./realization.1";

  it("shows the command once with a countdown from the clock and a not-shown-again warning", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    render(<PacketViewer markdown="# Title\n\n- one\n- two" cli={CLI} expiresAt="2026-01-01T00:12:03.000Z" />);
    expect(screen.getAllByText(CLI)).toHaveLength(1);
    expect(screen.getByText(/Neither is shown again/)).toBeTruthy();
    expect(screen.getByTestId("token-countdown").textContent).toBe("12 min 03 s");
    act(() => void vi.advanceTimersByTime(3_000));
    expect(screen.getByTestId("token-countdown").textContent).toBe("12 min 00 s");
    act(() => void vi.advanceTimersByTime(13 * 60_000));
    expect(screen.getByTestId("token-countdown").textContent).toBe("expired");
    fireEvent.click(screen.getByRole("button", { name: "I have copied it, hide" }));
    expect(screen.queryByText(CLI)).toBeNull();
    expect(document.body.textContent).not.toContain("tok_secret");
  });

  it("renders markdown without injecting HTML", () => {
    const { container } = render(<PacketViewer markdown={'# Heading\n\n<img src=x onerror="alert(1)"> **bold** `code`\n\n```\n<script>x</script>\n```\n\n1. first'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy();
    expect(container.textContent).toContain("<script>x</script>");
  });
});

describe("RealizationRow", () => {
  const conflicts: ConflictReport[] = [{ kind: "soft-semantic", candidates: ["cand.1", "cand.2"], subjects: [], nodes: ["screen.people"], paths: [], message: "Both edit the people screen" }];

  it("shows agent, fork, last checkpoint and conflict chips that name the other party", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [realization(), realization({ id: "realization.2", agent: { id: "agent-beta", role: "reviewer" }, checkpoints: [] })], conflicts }));
    const row = await screen.findByTestId("realization-realization.1");
    expect(within(row).getByText("agent-alpha")).toBeTruthy();
    expect(within(row).getByText("fork-alpha")).toBeTruthy();
    expect(within(row).getByText("fedcba9")).toBeTruthy();
    expect(within(row).getByText(/Scaffolded the app/)).toBeTruthy();
    const chip = within(row).getByRole("list", { name: "Conflicts" }).querySelector("li")!;
    expect(chip.textContent).toMatch(/soft-semantic with cand\.2 on 1 node/);
    // Soft overlaps wait on a person (attention); only hard-semantic is danger.
    expect(chip.getAttribute("data-tone")).toBe("attention");
    const beta = screen.getByTestId("realization-realization.2");
    expect(within(beta).getByText("checkpoint").nextElementSibling!.textContent).toBe("unknown");
  });

  it("counts the realization token down: attention under 30 minutes, danger once expired", async () => {
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    const gone = new Date(Date.now() - 60_000).toISOString();
    renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [
      realization({ workspace: { ...realization().workspace, tokenExpiresAt: soon } }),
      realization({ id: "realization.2", workspace: { ...realization().workspace, tokenExpiresAt: gone } }),
    ] }));
    const one = await screen.findByTestId("realization-realization.1");
    expect(within(one).getByText(/token expires in/).closest("[data-tone]")!.getAttribute("data-tone")).toBe("attention");
    expect(within(screen.getByTestId("realization-realization.2")).getByText("token expired").getAttribute("data-tone")).toBe("fail");
  });

  it("keeps the same DOM node when a refetch returns equal data", async () => {
    const { qc } = renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [realization()] }));
    const row = await screen.findByTestId("realization-realization.1");
    const data = qc.getQueryData(qk.evolutions(SYSTEM));
    act(() => void qc.setQueryData(qk.evolutions(SYSTEM), structuredClone(data)));
    expect(screen.getByTestId("realization-realization.1")).toBe(row);
  });
});

describe("Work hands decisions to Review", () => {
  const REVIEW = `/s/${SYSTEM}/r/head/review`;
  const waiting = realization({ status: "evaluated", candidate: "cand.1" });

  it("links Promote to the Review desk and keeps no promotion panel on Work", async () => {
    renderApp(`${WORK}?evolution=${EVO1}&candidates=cand.1`, undefined, seed({ realizations: [waiting] }));
    const link = await screen.findByRole("link", { name: "Promote in Review" });
    expect(link.getAttribute("href")).toBe(`${REVIEW}?candidates=cand.1&evolution=${EVO1}&panel=promote`);
    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Promote / })).toBeNull();
  });

  it("has no inline review on Work: each attempt links Open in Review", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [waiting] }));
    const row = await screen.findByTestId("realization-realization.1");
    expect(within(row).queryByRole("button", { name: /Review/ })).toBeNull();
    expect(within(row).getByRole("link", { name: /Open in Review realization\.1/ }).getAttribute("href")).toBe(`${REVIEW}?evolution=${EVO1}&realization=realization.1`);
  });

  it("marks a row whose candidate conflicts and that awaits review, with Open in Review and the header count", async () => {
    const soft: ConflictReport = { kind: "soft-semantic", candidates: ["cand.1", "cand.2"], subjects: [], nodes: ["screen.people"], message: "overlap" };
    renderApp(WORK, undefined, seed({ realizations: [waiting], conflicts: [soft] }));
    const row = await screen.findByRole("link", { name: /^Private contact foundation/ });
    await waitFor(() => expect(row.textContent).toMatch(/≈overlap/));
    expect(row.textContent).toMatch(/1 awaits review/);
    expect(row.querySelector('[data-tone="attention"]')).toBeTruthy();
    const item = row.closest("li")!;
    expect(within(item).getByRole("link", { name: /Open in Review/ }).getAttribute("href")).toBe(`${REVIEW}?evolution=${EVO1}&realization=realization.1`);
    const other = screen.getByRole("link", { name: new RegExp(`^${fixtureBundle().model.evolutions[4]!.title.replace(/[()]/g, ".")}`) });
    expect(other.textContent).not.toMatch(/overlap|awaits review/);
    expect(screen.getByRole("link", { name: "1 awaits review" }).getAttribute("href")).toBe(REVIEW);
  });
});

// CandidateReview moved to Review (the decide slice owns its file and tests); these stay until they move there.
describe("CandidateReview (on Review)", () => {
  const url = `/s/${SYSTEM}/r/head/review?evolution=${EVO1}&realization=realization.1`;
  const withCandidate = (extra = {}) => seed({ realizations: [realization()], candidates: [candidate(extra)] });

  it("groups subjects, marks unmapped files and toggles composition selection", async () => {
    const { router } = renderApp(url, undefined, withCandidate());
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect(within(review).getByText("Changed (operation unknown)")).toBeTruthy();
    expect(within(review).getByText("Unmapped")).toBeTruthy();
    fireEvent.click(within(review).getByRole("tab", { name: "Files" }));
    const files = within(review).getByRole("list", { name: "Changed files" });
    expect(within(files).getByText("src/odd.ts").parentElement?.textContent).toMatch(/unmapped/);
    expect(within(files).getByText("src/app.ts").parentElement?.textContent).not.toMatch(/unmapped/);
    fireEvent.click(within(review).getByRole("button", { name: "Add to promotion" }));
    await waitFor(() => expect(router.state.location.search).toContain("candidates=cand.1"));
    await waitFor(() => expect(within(review).getByRole("button", { name: "Add to promotion" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("uses per-subject operations when the backend sends them", async () => {
    renderApp(url, undefined, withCandidate({ subjectDelta: { added: ["screen.people"], changed: ["thing.webapp"], removed: [] } }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect(within(review).getByText("Added")).toBeTruthy();
    expect(within(review).queryByText("Changed (operation unknown)")).toBeNull();
  });

  it("lists this candidate's evaluations and empty-states honestly", async () => {
    renderApp(url, undefined, seed({ realizations: [realization()], candidates: [candidate()], evals: [evalFor("C.webapp.exists")] }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    fireEvent.click(within(review).getByRole("tab", { name: /^Evaluations/ }));
    expect(within(review).getAllByRole("row")).toHaveLength(2);
  });

  it("mounts the amendment review for genome realizations with the evolution id and system id", async () => {
    renderApp(url, undefined, seed({ realizations: [realization({ target: "genome" })], candidates: [candidate()] }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    fireEvent.click(within(review).getByRole("tab", { name: "Amendment" }));
    expect(await within(review).findByText(/amendment review/i)).toBeTruthy();
  });

  it("re-run checks is disabled with the standard reason in fixture mode", async () => {
    renderApp(url, undefined, withCandidate());
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect((within(review).getByRole("button", { name: "Re-run checks" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(review).getByText("Re-run checks needs the platform API. The UI is showing fixture data.")).toBeTruthy();
  });

  it("re-run checks posts to the candidate's evaluate route with the header admin token", async () => {
    const posts: { url: string; auth: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
      const path = String(u);
      if (path.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST") {
        posts.push({ url: path, auth: new Headers(init.headers).get("authorization") });
        return json(200, { realization: realization(), candidate: candidate(), evaluations: [evalFor("C.webapp.health")] });
      }
      if (path.endsWith("/realization-plans")) return json(200, { plans: [] });
      if (path.includes("/model")) return json(200, { ...fixtureBundle(), source: "api" });
      if (path.includes("/candidates")) return json(200, { evolution: EVO1, candidates: [candidate()], evaluations: [], conflicts: [] });
      if (path.includes("/evaluations")) return json(200, { evaluations: [] });
      if (path.includes("/evolutions")) return json(200, { evolutions: [], realizations: [realization()] });
      return json(200, { conflicts: [], commits: [] });
    }));
    sessionStorage.setItem("artyfact.adminToken", "adm_header");
    try {
      renderApp(url, undefined, seed({ api: true, realizations: [realization()], candidates: [candidate()] }));
      const review = await screen.findByRole("region", { name: "Review realization.1" });
      const button = within(review).getByRole("button", { name: "Re-run checks" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect((await within(review).findByRole("status")).textContent).toMatch(/Checks re-run: 1 evaluation recorded/);
      expect(posts).toEqual([{ url: `/api/systems/${encodeURIComponent(SYSTEM)}/candidates/cand.1/evaluate`, auth: "Bearer adm_header" }]);
    } finally {
      sessionStorage.clear();
    }
  });

  it("re-run checks is disabled for a promoted candidate", async () => {
    renderApp(url, undefined, seed({ api: true, realizations: [realization()], candidates: [candidate({ state: "promoted" })] }));
    const review = await screen.findByRole("region", { name: "Review realization.1" });
    expect((within(review).getByRole("button", { name: "Re-run checks" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(review).getByText(/is promoted; its checks are final/)).toBeTruthy();
  });

  it("says there is nothing to review before a candidate is submitted", async () => {
    renderApp(url, undefined, seed({ realizations: [realization()], candidates: [] }));
    expect(await screen.findByText(/nothing to review/)).toBeTruthy();
  });
});

const ALL_CRITERIA = fixtureBundle().model.criteria.map((c) => c.id);

describe("New Evolution", () => {
  const systemsStub = (posts: unknown[], created?: unknown) => vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/realization-plans")) return json(200, { plans: [] });
    if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
    if (u.endsWith("/evolutions") && init?.method === "POST") {
      posts.push({ body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
      return created ? json(201, { evolution: created }) : json(500, { error: { code: "x", message: "stop" } });
    }
    if (u.includes("/evolutions")) return json(200, { evolutions: created ? [created] : [], realizations: [] });
    return json(404, { error: { code: "not-found", message: "no" } });
  }));

  it("defaults to the System's criteria; Choose criteria sends the picked ids, [] when cleared, all with Select all", async () => {
    const posts: { body: { acceptanceCriteria?: string[]; kind?: string } }[] = [];
    systemsStub(posts);
    sessionStorage.setItem("artyfact.adminToken", "adm");
    renderApp(`${WORK}?panel=new`, undefined, seed({ api: true }));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    fireEvent.change(within(panel).getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(within(panel).getByLabelText("Intent"), { target: { value: "I" } });
    expect(within(panel).getByText("Using the System's defaults for this target.")).toBeTruthy();
    // No one-option Kind select and no per-form token field.
    expect(within(panel).queryByRole("combobox", { name: "Kind" })).toBeNull();
    expect(within(panel).queryByLabelText("Admin token")).toBeNull();
    const boxes = within(panel).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(ALL_CRITERIA.length);
    expect(boxes.some((b) => b.checked)).toBe(false);
    const create = () => fireEvent.click(within(panel).getByRole("button", { name: "Create Evolution" }));
    create();
    await waitFor(() => expect(posts.length).toBe(1));
    expect("acceptanceCriteria" in posts[0]!.body).toBe(false);
    expect(posts[0]!.body.kind).toBe("genome-amendment");
    fireEvent.click(boxes[1]!);
    create();
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[1]!.body.acceptanceCriteria).toEqual([ALL_CRITERIA[1]]);
    fireEvent.click(boxes[1]!);
    create();
    await waitFor(() => expect(posts.length).toBe(3));
    expect(posts[2]!.body.acceptanceCriteria).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Select all" }));
    create();
    await waitFor(() => expect(posts.length).toBe(4));
    expect(posts[3]!.body.acceptanceCriteria).toEqual(ALL_CRITERIA);
    fireEvent.click(within(panel).getByRole("button", { name: "Use the System's defaults" }));
    fireEvent.change(within(panel).getByLabelText("Filter criteria"), { target: { value: ALL_CRITERIA[0]! } });
    expect(within(panel).getAllByRole("checkbox").length).toBeLessThan(ALL_CRITERIA.length);
    create();
    await waitFor(() => expect(posts.length).toBe(5));
    expect("acceptanceCriteria" in posts[4]!.body).toBe(false);
  });

  it("without the header token Create Evolution says why", async () => {
    systemsStub([]);
    renderApp(`${WORK}?panel=new`, undefined, seed({ api: true }));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    expect((within(panel).getByRole("button", { name: "Create Evolution" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText("Set the admin token in the header.")).toBeTruthy();
  });

  it("+ Evolution replaces the list and detail with the panel, disabled with the standard reason on fixture data", async () => {
    const { router } = renderApp(`${WORK}?evolution=${EVO1}`);
    fireEvent.click(await screen.findByRole("button", { name: "Evolution" }));
    await waitFor(() => expect(router.state.location.search).toBe("?panel=new"));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    expect(screen.queryByRole("region", { name: "Plans and Evolutions" })).toBeNull();
    expect((within(panel).getByRole("button", { name: "Create Evolution" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText("Creating an Evolution needs the platform API. The UI is showing fixture data.")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Back to Work" }));
    await waitFor(() => expect(router.state.location.search).not.toContain("panel"));
  });

  it("creates an Evolution with affected nodes and risk, selects it and lists it in Proposed", async () => {
    const created = { ...fixtureBundle().model.evolutions[0]!, id: "evolution.new", title: "Reminder nudges", intent: "Nudge owners", kind: "genome-amendment" as const, state: "proposed" as const, affectedNodes: ["screen.people"], acceptanceCriteria: [] };
    const posts: unknown[] = [];
    systemsStub(posts, created);
    sessionStorage.setItem("artyfact.adminToken", "s3cret");
    const { router } = renderApp(`${WORK}?panel=new`, undefined, seed({ api: true }));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    fireEvent.change(within(panel).getByLabelText("Title"), { target: { value: "Reminder nudges" } });
    fireEvent.change(within(panel).getByLabelText("Intent"), { target: { value: "Nudge owners" } });
    fireEvent.change(within(panel).getByLabelText("Affected nodes"), { target: { value: "screen.people" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add node" }));
    expect(within(panel).getByRole("button", { name: "Remove screen.people" })).toBeTruthy();
    fireEvent.click(within(panel).getByRole("radio", { name: "low" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Create Evolution" }));
    await waitFor(() => expect(router.state.location.search).toBe("?evolution=evolution.new"));
    expect(posts).toEqual([{ body: { title: "Reminder nudges", intent: "Nudge owners", kind: "genome-amendment", risk: "low", affectedNodes: ["screen.people"] }, auth: "Bearer s3cret" }]);
    const proposed = await waitFor(() => {
      const el = document.querySelector('details[data-group="proposed"]') as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(await within(proposed).findByRole("link", { name: /^Reminder nudges/ })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("region", { name: "New Evolution" })).toBeNull());
  });
});

describe("itemVerdict (server gate items)", () => {
  it("falls back to the verdict when execution is absent; only pass needs a completed run", () => {
    expect(itemVerdict({ criterion: "c", verdict: "fail" })).toBe("fail");
    expect(itemVerdict({ criterion: "c", verdict: "pass" })).toBe("unknown");
    expect(itemVerdict({ criterion: "c", verdict: "pass", execution: "completed" })).toBe("pass");
    expect(itemVerdict({ criterion: "c", verdict: "pass", execution: "running" })).toBe("not-run");
    expect(itemVerdict({ criterion: "c", verdict: "missing", execution: "missing" })).toBe("not-run");
    expect(itemVerdict({ criterion: "c", verdict: "fail", execution: "error" })).toBe("unknown");
  });
});

describe("BuildChip", () => {
  it("shows unknown without a build and the status with a preview link", async () => {
    const { BuildChip } = await import("./BuildChip");
    const { container, rerender } = render(<BuildChip />);
    expect(screen.getByText("build unknown")).toBeTruthy();
    expect(container.querySelector('[data-tone="pass"]')).toBeNull();
    rerender(<BuildChip build={{ id: "b", status: "passed", kind: "preview", commit: "abc", url: "https://p.example.dev" }} />);
    expect(screen.getByText("build passed").getAttribute("data-tone")).toBe("pass");
    expect(screen.getByRole("link", { name: "Preview" }).getAttribute("rel")).toContain("noopener");
    rerender(<BuildChip build={{ id: "b", status: "failed", kind: "preview", commit: "abc" }} />);
    expect(screen.getByText("build failed").getAttribute("data-tone")).toBe("fail");
  });
});
it("Genome Evolution work has one target, so no Target select", async () => {
  const genomeEvolution = fixtureBundle().model.evolutions.find((e) => e.kind === "genome-amendment")!;
  renderApp(`${WORK}?evolution=${genomeEvolution.id}&panel=start`);
  expect(await screen.findByText(/a Genome Evolution changes the Genome only/)).toBeTruthy();
  expect(screen.queryByLabelText("Target")).toBeNull();
});
