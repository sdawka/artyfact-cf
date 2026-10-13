import type { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
afterEach(() => vi.useRealTimers());

describe("Work board", () => {
  it("groups the six fixture evolutions by state", async () => {
    renderApp(WORK);
    const proposed = await screen.findByRole("region", { name: /Proposed/ });
    expect(within(proposed).getAllByRole("button")).toHaveLength(5);
    expect(within(screen.getByRole("region", { name: /^Actionable/ })).getAllByRole("button")).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: /^Realizing/ })).getByText("none")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(
      ["Proposed", "Genome approved", "Actionable", "Realizing", "Evaluated", "Promoted", "Rejected"],
    );
  });

  it("shows kind, intent, capped affected chips, criteria count and dependencies on a card", async () => {
    renderApp(WORK);
    const one = await screen.findByRole("button", { name: "Private contact foundation" });
    expect(one.textContent).toMatch(/implementation/);
    expect(one.textContent).toMatch(/7 acceptance criteria/);
    expect(one.textContent).toMatch(/0\/7 pass/);
    expect(one.textContent).toMatch(/\+2 more/);
    expect(one.textContent).not.toMatch(/depends on/);
    const proposed = within(screen.getByRole("region", { name: /Proposed/ })).getAllByRole("button");
    expect(proposed.some((c) => /depends on/.test(c.textContent ?? ""))).toBe(true);
    expect(proposed.some((c) => /genome-amendment/.test(c.textContent ?? ""))).toBe(true);
  });

  it("never shows a not-run rollup as green", async () => {
    renderApp(WORK);
    await screen.findByRole("region", { name: /Actionable/ });
    expect(document.querySelector('[data-verdict="pass"]')).toBeNull();
    expect(document.querySelector('[data-verdict="not-run"]')).not.toBeNull();
  });

  it("opens the detail pane from ?evolution= and by clicking a card", async () => {
    const { router } = renderApp(WORK);
    fireEvent.click(await screen.findByRole("button", { name: "Private contact foundation" }));
    await waitFor(() => expect(router.state.location.search).toContain("evolution=evolution.1"));
    expect(await screen.findByRole("heading", { level: 2, name: "Private contact foundation" })).toBeTruthy();
    expect(screen.getByText("No one is working on this Evolution.")).toBeTruthy();
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
});

describe("StartWorkPanel against the API", () => {
  it("submits, then shows the packet and the command once", async () => {
    const cli = "ARTYFACT_TOKEN=tok_x ARTYFACT_SECRET=sec_x npx artyfact start realization.9 --system system.keep-in-touch --evolution evolution.1 --dir ./realization.9";
    const calls: unknown[] = [];
    const auth: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST" && u.endsWith("/evolutions/evolution.1/realizations")) {
        calls.push(JSON.parse(String(init.body)));
        auth.push(new Headers(init.headers).get("authorization"));
        return json(201, { realization: realization({ id: "realization.9" }), packet: { json: {}, markdown: "# Task\n\n- build it" }, token: "tok_x", remote: "https://git/fork", cli });
      }
      return json(200, { evolutions: [], realizations: [] });
    }));
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    fireEvent.change(await screen.findByLabelText("Agent label"), { target: { value: "codex-1" } });
    const tokenInput = screen.getByLabelText("Admin token") as HTMLInputElement;
    expect(tokenInput.type).toBe("password");
    fireEvent.change(tokenInput, { target: { value: "adm_x" } });
    const submit = screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(await screen.findAllByText(cli)).toHaveLength(1);
    expect(calls).toEqual([{ agentLabel: "codex-1", target: "app", role: "implementer" }]);
    expect(auth).toEqual(["Bearer adm_x"]);
    expect(screen.getByRole("heading", { name: "Task" })).toBeTruthy();
    expect(screen.getByText(/Neither is shown again/)).toBeTruthy();
  });

  it("pre-fills the token field from the header token and sends it as the bearer", async () => {
    const cli = "npx artyfact start realization.9";
    const auth: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST") {
        auth.push(new Headers(init.headers).get("authorization"));
        return json(201, { realization: realization({ id: "realization.9" }), packet: { json: {}, markdown: "# Task" }, token: "tok_x", remote: "https://git/fork", cli });
      }
      return json(200, { evolutions: [], realizations: [] });
    }));
    sessionStorage.setItem("artyfact.adminToken", "adm_header");
    try {
      renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
      const tokenInput = (await screen.findByLabelText("Admin token", { selector: "input" })) as HTMLInputElement;
      expect(tokenInput.value).toBe("adm_header");
      fireEvent.click(screen.getAllByRole("button", { name: "Start work" }).find((b) => b.getAttribute("type") === "submit")!);
      await screen.findAllByText(cli);
      expect(auth).toEqual(["Bearer adm_header"]);
    } finally {
      sessionStorage.clear();
    }
  });

  it.each([
    [401, /needs the admin token \(401\)/],
    [403, /admin token was refused \(403\)/],
  ])("says plainly when start work is refused with %i", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (init?.method === "POST") return json(status, { error: { code: status === 401 ? "unauthorized" : "forbidden", message: "nope" } });
      return json(200, { evolutions: [], realizations: [] });
    }));
    renderApp(`${WORK}?evolution=${EVO1}&panel=start`, undefined, seed({ api: true }));
    await screen.findByLabelText("Admin token");
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
  const CLI = "ARTYFACT_TOKEN=tok_secret npx artyfact start realization.1 --system system.keep-in-touch --evolution evolution.1 --dir ./realization.1";

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

  it("shows agent, fork, last checkpoint and typed conflict chips", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [realization(), realization({ id: "realization.2", agent: { id: "agent-beta", role: "reviewer" }, checkpoints: [] })], conflicts }));
    const row = await screen.findByTestId("realization-realization.1");
    expect(within(row).getByText("agent-alpha")).toBeTruthy();
    expect(within(row).getByText("fork-alpha")).toBeTruthy();
    expect(within(row).getByText("fedcba9")).toBeTruthy();
    expect(within(row).getByText(/Scaffolded the app/)).toBeTruthy();
    expect(within(row).getByText(/soft-semantic/)).toBeTruthy();
    expect(within(screen.getByTestId("realization-realization.2")).getByText(/Last checkpoint:\s*unknown/)).toBeTruthy();
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
    const link = await screen.findByRole("link", { name: "Promote" });
    expect(link.getAttribute("href")).toBe(`${REVIEW}?candidates=cand.1&evolution=${EVO1}&panel=promote`);
    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Promote / })).toBeNull();
  });

  it("keeps the inline review on a realization row and adds Open in Review", async () => {
    renderApp(`${WORK}?evolution=${EVO1}`, undefined, seed({ realizations: [waiting] }));
    const row = await screen.findByTestId("realization-realization.1");
    expect(within(row).getByRole("button", { name: /Review realization\.1/ })).toBeTruthy();
    expect(within(row).getByRole("link", { name: /Open in Review realization\.1/ }).getAttribute("href")).toBe(`${REVIEW}?evolution=${EVO1}&realization=realization.1`);
  });

  it("marks a card whose candidate conflicts and that awaits review", async () => {
    const soft: ConflictReport = { kind: "soft-semantic", candidates: ["cand.1", "cand.2"], subjects: [], nodes: ["screen.people"], message: "overlap" };
    renderApp(WORK, undefined, seed({ realizations: [waiting], conflicts: [soft] }));
    const card = await screen.findByRole("button", { name: "Private contact foundation" });
    await waitFor(() => expect(card.textContent).toMatch(/≈ overlap/));
    expect(card.textContent).toMatch(/1 awaits review/);
    const other = screen.getByRole("button", { name: fixtureBundle().model.evolutions[1]!.title });
    expect(other.textContent).not.toMatch(/overlap|awaits review/);
  });
});

describe("CandidateReview", () => {
  const url = `${WORK}?evolution=${EVO1}&realization=realization.1`;
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
    fireEvent.click(within(review).getByRole("button", { name: "Select for composition" }));
    await waitFor(() => expect(router.state.location.search).toContain("candidates=cand.1"));
    expect(await within(review).findByRole("button", { name: "Selected for composition" })).toBeTruthy();
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
    fireEvent.click(within(review).getByRole("tab", { name: "Evaluations" }));
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
  it("omits acceptanceCriteria untouched, sends the picked ids once touched, and [] when cleared", async () => {
    const posts: { acceptanceCriteria?: string[] }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (u.endsWith("/evolutions") && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return json(500, { error: { code: "x", message: "stop" } });
      }
      if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
      return json(404, { error: { code: "not-found", message: "no" } });
    }));
    renderApp(`${WORK}?panel=new`, undefined, seed({ api: true }));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    fireEvent.change(within(panel).getByLabelText("Title"), { target: { value: "T" } });
    fireEvent.change(within(panel).getByLabelText("Intent"), { target: { value: "I" } });
    const boxes = within(panel).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(ALL_CRITERIA.length);
    expect(boxes.some((b) => b.checked)).toBe(false);
    const create = () => fireEvent.click(within(panel).getByRole("button", { name: "Create Evolution" }));
    create();
    await waitFor(() => expect(posts.length).toBe(1));
    expect("acceptanceCriteria" in posts[0]!).toBe(false);
    fireEvent.click(boxes[1]!);
    create();
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[1]!.acceptanceCriteria).toEqual([ALL_CRITERIA[1]]);
    fireEvent.click(boxes[1]!);
    create();
    await waitFor(() => expect(posts.length).toBe(3));
    expect(posts[2]!.acceptanceCriteria).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Select all" }));
    create();
    await waitFor(() => expect(posts.length).toBe(4));
    expect(posts[3]!.acceptanceCriteria).toEqual(ALL_CRITERIA);
  });

  it("+ Evolution opens the panel, disabled with the standard reason on fixture data", async () => {
    const { router } = renderApp(`${WORK}?evolution=${EVO1}`);
    fireEvent.click(await screen.findByRole("button", { name: "+ Evolution" }));
    await waitFor(() => expect(router.state.location.search).toBe("?panel=new"));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    expect((within(panel).getByRole("button", { name: "Create Evolution" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText("Creating an Evolution needs the platform API. The UI is showing fixture data.")).toBeTruthy();
  });

  it("creates an Evolution with affected nodes, selects it and shows its card in Proposed", async () => {
    const created = { ...fixtureBundle().model.evolutions[0]!, id: "evolution.new", title: "Reminder nudges", intent: "Nudge owners", state: "proposed" as const, affectedNodes: ["screen.people"], acceptanceCriteria: [] };
    const posts: { body: unknown; auth: string | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
      if (u.endsWith("/evolutions") && init?.method === "POST") {
        posts.push({ body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
        return json(201, { evolution: created });
      }
      if (u.includes("/evolutions")) return json(200, { evolutions: [created], realizations: [] });
      return json(404, { error: { code: "not-found", message: "no" } });
    }));
    const { router } = renderApp(`${WORK}?panel=new`, undefined, seed({ api: true }));
    const panel = await screen.findByRole("region", { name: "New Evolution" });
    fireEvent.change(within(panel).getByLabelText("Title"), { target: { value: "Reminder nudges" } });
    fireEvent.change(within(panel).getByLabelText("Intent"), { target: { value: "Nudge owners" } });
    fireEvent.change(within(panel).getByLabelText("Affected nodes"), { target: { value: "screen.people" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add node" }));
    expect(within(panel).getByRole("button", { name: "Remove screen.people" })).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText("Risk"), { target: { value: "low" } });
    fireEvent.change(within(panel).getByLabelText("Admin token"), { target: { value: "s3cret" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Create Evolution" }));
    await waitFor(() => expect(router.state.location.search).toBe("?evolution=evolution.new"));
    expect(posts).toEqual([{ body: { title: "Reminder nudges", intent: "Nudge owners", kind: "mixed", risk: "low", affectedNodes: ["screen.people"] }, auth: "Bearer s3cret" }]);
    const proposed = await screen.findByRole("region", { name: /Proposed/ });
    expect(await within(proposed).findByRole("button", { name: "Reminder nudges" })).toBeTruthy();
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
