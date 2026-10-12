import type { QueryClient } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
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
  const keys = [...new Set(events.map((e) => e.buildId))];
  qc.setQueryData(qk.phenome(SYSTEM, s.query ?? {}), {
    events,
    versions: keys.map((key) => ({ key, buildId: key, commit: key, deployment: null, systemCommit: null, count: events.filter((e) => e.buildId === key).length })),
  });
};

describe("Deployments page", () => {
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
