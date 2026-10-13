import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TemplateUpgradeNoScaffold, TemplateUpgradePlan } from "../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.peopling";
const OVERVIEW = `/s/${SYSTEM}/r/head/overview`;
const TO = "b".repeat(40);
const PLAN: TemplateUpgradePlan = {
  template: "thing/cloudflare-worker-webapp@1", from: "a".repeat(40), to: TO, upToDate: false, locked: true,
  app: { repo: "peopling.app", commit: "c".repeat(40) },
  files: [
    { path: "src/worker/phenome.ts", action: "add", reason: "new in the template" },
    { path: "src/worker/env.ts", action: "update", reason: "unchanged by the app since it was scaffolded; the template changed it" },
    { path: "src/old.ts", action: "remove", reason: "the template no longer ships it, and the app did not edit it" },
    { path: "src/index.ts", action: "conflict", reason: "the app edited it, and the template changed it too" },
    { path: "wrangler.jsonc", action: "conflict", reason: "the app edited it, and the template changed it too" },
  ],
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const apiSeed = (qc: import("@tanstack/react-query").QueryClient) => qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });

function stubApi(plan: TemplateUpgradePlan | TemplateUpgradeNoScaffold, onPost?: (body: unknown, auth: string | null) => Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
    if (u.includes("/template-upgrade")) {
      if (init?.method === "POST") return onPost!(JSON.parse(String(init.body)), new Headers(init.headers).get("authorization"));
      return json(200, plan);
    }
    if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
    if (u.includes("/deployments")) return json(200, { production: null, history: [] });
    return json(404, { error: { code: "not-found", message: "no" } });
  }));
}

describe("App template card", () => {
  it("shows unknown on fixture data, with the button disabled and the standard reason", async () => {
    renderApp(OVERVIEW);
    const card = await screen.findByRole("region", { name: "App template" });
    expect(within(card).getByText("unknown")).toBeTruthy();
    const button = within(card).getByRole("button", { name: "Review upgrade" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(within(card).getByText("Template upgrades need the platform API. The UI is showing fixture data.")).toBeTruthy();
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("renders no card, and no console error, when the template ships no scaffold", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stubApi({ status: "no-scaffold", template: "thing/ts-library@1" });
    renderApp(OVERVIEW, undefined, apiSeed);
    const fetched = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([u]) => String(u).includes("/template-upgrade"));
    await waitFor(() => expect(fetched()).toBe(true));
    await screen.findByRole("heading", { name: "Overview" }).catch(() => undefined);
    await waitFor(() => expect(screen.queryByRole("region", { name: "App template" })).toBeNull());
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("says up to date and keeps the button disabled", async () => {
    stubApi({ ...PLAN, upToDate: true, files: [] });
    renderApp(OVERVIEW, undefined, apiSeed);
    const card = await screen.findByRole("region", { name: "App template" });
    expect(await within(card).findByText(/up to date with thing\/cloudflare-worker-webapp@1 at bbbbbbb/)).toBeTruthy();
    expect((within(card).getByRole("button", { name: "Review upgrade" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lists the plan by action, sends the included conflicts with the admin token, then opens Work", async () => {
    const posts: { body: unknown; auth: string | null }[] = [];
    stubApi(PLAN, (body, auth) => {
      posts.push({ body, auth });
      return json(201, { evolution: { id: "evolution.ev-7" }, realization: { id: "realization.12" }, candidate: { id: "candidate.12.r1" }, plan: PLAN });
    });
    const { router } = renderApp(OVERVIEW, undefined, apiSeed);
    const card = await screen.findByRole("region", { name: "App template" });
    expect(await within(card).findByText(/5 files behind thing\/cloudflare-worker-webapp@1 at bbbbbbb/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Review upgrade" }));

    for (const [group, paths] of [["Add", ["src/worker/phenome.ts"]], ["Update", ["src/worker/env.ts"]], ["Remove", ["src/old.ts"]], ["Conflict", ["src/index.ts", "wrangler.jsonc"]]] as const) {
      const g = within(card).getByRole("group", { name: new RegExp(`^${group}`) });
      expect(within(g).getAllByRole("listitem").map((li) => li.querySelector("code")!.textContent)).toEqual(paths);
    }
    const conflict = within(card).getByRole("group", { name: /^Conflict/ });
    expect(within(conflict).getAllByRole("checkbox")).toHaveLength(2);
    const compare = within(conflict).getAllByRole("link", { name: "Compare" })[0]!.getAttribute("href")!;
    expect(compare).toContain("/compare?");
    expect(compare).toContain("level=files");
    expect(compare).toContain("path=src%2Findex.ts");
    expect(within(within(card).getByRole("group", { name: /^Add/ })).queryByRole("link", { name: "Compare" })).toBeNull();

    fireEvent.click(within(card).getByRole("checkbox", { name: "Use template version of src/index.ts" }));
    const token = within(card).getByLabelText("Admin token") as HTMLInputElement;
    expect(token.type).toBe("password");
    fireEvent.change(token, { target: { value: "adm_x" } });
    fireEvent.click(within(card).getByRole("button", { name: "Start upgrade" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/${SYSTEM}/r/head/work`));
    expect(posts).toEqual([{ body: { include: ["src/index.ts"] }, auth: "Bearer adm_x" }]);
    const params = new URLSearchParams(router.state.location.search);
    expect([params.get("evolution"), params.get("realization")]).toEqual(["evolution.ev-7", "realization.12"]);
  });

  it("says plainly when the admin token is refused", async () => {
    stubApi(PLAN, () => json(403, { error: { code: "forbidden", message: "nope" } }));
    renderApp(OVERVIEW, undefined, apiSeed);
    const card = await screen.findByRole("region", { name: "App template" });
    await within(card).findByText(/5 files behind/);
    fireEvent.click(within(card).getByRole("button", { name: "Review upgrade" }));
    fireEvent.click(within(card).getByRole("button", { name: "Start upgrade" }));
    expect((await within(card).findByRole("alert")).textContent).toMatch(/admin token was refused \(403\)/);
  });
});
