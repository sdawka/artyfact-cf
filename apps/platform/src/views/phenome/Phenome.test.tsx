import type { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Build, Deployment, PhenomeEvent } from "../../../shared/api";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.keep-in-touch";
const PATH = `/s/${SYSTEM}/r/head/phenome`;
const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);
const T = "2026-01-01T00:00:00.000Z";

const build = (o: Partial<Build> = {}): Build => ({
  id: "build.1", status: "passed", kind: "preview", commit: COMMIT, realization: "realization.1", candidate: "cand.1", reporter: "ci",
  url: "https://preview.example.dev", steps: [{ name: "install", status: "passed" }, { name: "test", status: "failed" }],
  startedAt: T, createdAt: T, updatedAt: T, ...o,
});
const deployment = (o: Partial<Deployment> = {}): Deployment => ({
  id: "deploy.1", kind: "production", status: "live", repo: "app", commit: COMMIT, systemCommit: "sc-2", build: "build.9",
  url: "https://app.example.dev", buildId: COMMIT, by: "admin", createdAt: T, updatedAt: T, ...o,
});
const event = (seq: number, buildId: string, o: Partial<PhenomeEvent> = {}): PhenomeEvent => ({
  seq, receivedAt: T, systemId: SYSTEM, thingId: "thing.webapp", artifactId: "artifact.webapp", buildId, commit: buildId, emittedAt: T,
  kind: "journey.step", payload: {}, ...o,
});

interface Seed { builds?: Build[]; production?: Deployment | null; history?: Deployment[]; events?: PhenomeEvent[]; query?: object }
const seed = (s: Seed = {}) => (qc: QueryClient) => {
  qc.setQueryData(qk.builds(SYSTEM, {}), { builds: s.builds ?? [] });
  qc.setQueryData(qk.deployments(SYSTEM), { production: s.production ?? null, history: s.history ?? [] });
  const events = s.events ?? [];
  const keyOf = (e: PhenomeEvent) => e.outputId || e.buildId || e.commit;
  const keys = [...new Set(events.map(keyOf))];
  qc.setQueryData(qk.phenome(SYSTEM, s.query ?? {}), {
    events,
    versions: keys.map((key) => { const first = events.find((e) => keyOf(e) === key)!; return { key, output: first.outputId ?? null, genomeCommit: first.genomeCommit ?? null, buildId: first.buildId, commit: first.commit, deployment: null, systemCommit: null, count: events.filter((e) => keyOf(e) === key).length }; }),
  });
};

describe("Deployments page", () => {
  it("notes that admin actions need the header token, until one is set", async () => {
    sessionStorage.clear();
    renderApp(PATH, undefined, seed());
    expect(await screen.findByText("Admin actions need the admin token: set it in the header.")).toBeTruthy();
    sessionStorage.setItem("artyfact.adminToken", "adm");
    try {
      cleanup();
      renderApp(PATH, undefined, seed());
      await screen.findByRole("heading", { level: 1, name: "Deployments" });
      expect(screen.queryByText(/Admin actions need the admin token/)).toBeNull();
    } finally {
      sessionStorage.clear();
    }
  });

  it("keeps other Things' builds and events outside a scoped Thing workspace", async () => {
    renderApp(`/s/${SYSTEM}/r/head/things/thing.webapp/phenome`, undefined, seed({
      builds: [build({ thingId: "thing.webapp", candidate: "cand.selected" }), build({ id: "build.other", thingId: "thing.other", candidate: "cand.other" })],
      events: [event(2, COMMIT, { kind: "selected.event" }), event(1, OTHER, { thingId: "thing.other", kind: "other.event" })],
    }));
    expect(await screen.findByText("cand.selected")).toBeTruthy();
    expect(screen.queryByText("cand.other")).toBeNull();
    expect(screen.getByText("selected.event")).toBeTruthy();
    expect(screen.queryByText("other.event")).toBeNull();
  });

  it("separates events for distinct outputs built from the same source", async () => {
    renderApp(PATH, undefined, seed({ events: [event(2, COMMIT, { outputId: "output.two" }), event(1, COMMIT, { outputId: "output.one" })] }));
    const groups = await screen.findAllByText(/events/, { selector: "summary" });
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.textContent)).toEqual([expect.stringContaining("output.two"), expect.stringContaining("output.one")]);
  });

  it("distinguishes realized output identity from source and keeps legacy identity unknown", async () => {
    renderApp(PATH, undefined, seed({
      builds: [build({ output: { id: "output.known", thingId: "thing.webapp", artifactId: "artifact.webapp", source: { repo: "app", commit: COMMIT }, genomeCommit: OTHER, build: "build.1", createdAt: T } }), build({ id: "build.legacy" })],
      production: deployment({ output: "output.known" }),
      events: [event(1, COMMIT, { outputId: "output.known", genomeCommit: OTHER })],
    }));
    expect(await screen.findAllByText("output.known")).toHaveLength(3);
    expect(screen.getByText("Output unknown")).toBeTruthy();
    expect(screen.getByText(/Source app@aaaaaaa/)).toBeTruthy();
  });

  it("shows the empty state with the literal unknown and nothing green", async () => {
    const { container } = renderApp(PATH, undefined, seed());
    expect(await screen.findByRole("heading", { level: 1, name: "Deployments" })).toBeTruthy();
    expect(screen.getByText(/No deployments recorded/).textContent).toContain("unknown");
    expect(screen.getByText("No events ingested.")).toBeTruthy();
    expect(container.querySelector('[data-tone="pass"], [data-verdict="pass"]')).toBeNull();
  });

  it("lists builds with steps, a safe preview link and the candidate", async () => {
    renderApp(PATH, undefined, seed({ builds: [build()] }));
    const steps = await screen.findByRole("list", { name: "Steps of build.1" });
    expect(within(steps).getByText("install: passed")).toBeTruthy();
    expect(within(steps).getByText("test: failed")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Preview" });
    expect(link.getAttribute("href")).toBe("https://preview.example.dev");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("cand.1")).toBeTruthy();
  });

  it("groups events by version key under ?deployment=", async () => {
    renderApp(`${PATH}?deployment=deploy.1`, undefined, seed({
      query: { deployment: "deploy.1" },
      events: [event(3, COMMIT), event(2, COMMIT), event(1, OTHER)],
    }));
    const groups = await screen.findAllByText(/events/, { selector: "summary" });
    expect(groups.map((g) => g.textContent)).toEqual([expect.stringContaining("aaaaaaa · 2 events"), expect.stringContaining("bbbbbbb · 1 events")]);
  });

  it("uses the fail tone for failed builds and pass only for passed", async () => {
    const { container } = renderApp(PATH, undefined, seed({
      builds: [build({ id: "b.fail", status: "failed" }), build({ id: "b.run", status: "running" }), build({ id: "b.err", status: "error" }), build({ id: "b.ok", status: "passed" })],
      production: deployment(),
    }));
    await screen.findByRole("list", { name: "Steps of b.ok" });
    const tone = (status: string) => container.querySelector(`[data-status="${status}"][data-tone]`)!.getAttribute("data-tone");
    expect(tone("failed")).toBe("fail");
    expect(tone("error")).toBe("fail");
    expect(tone("running")).toBe("neutral");
    expect(tone("passed")).toBe("pass");
    expect(container.querySelector('[data-status="live"]')!.getAttribute("data-tone")).toBe("neutral");
    expect(container.querySelectorAll('[data-tone="pass"]')).toHaveLength(1);
  });
});
