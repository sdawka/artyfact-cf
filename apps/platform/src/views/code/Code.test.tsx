import type { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { editorText, typeInEditor } from "@/testing/codemirror";
import { renderApp } from "@/testing/render";

const SYSTEM = "system.peopling";
const CODE = `/s/${SYSTEM}/r/head/code`;
const FILES: Record<string, string> = {
  "system.yaml": "id: system.peopling\n",
  "purpose.yaml": "purpose: stay in touch\n",
  "things/webapp/thing.yaml": "id: webapp\n",
};
const EVOLUTION = { ...fixtureBundle().model.evolutions[0]!, state: "actionable" as const };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ref = { ref: "head", repo: "genome", commit: "a".repeat(40) };

interface Call { method: string; url: string; body: unknown; auth: string | null }

/** A reachable API with three Genome files; `post` answers writes (default: success). */
function stubApi(post: (url: string, call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const call = { method, url, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.get("authorization") };
    calls.push(call);
    if (method === "POST") {
      const custom = post(url, call);
      if (custom) return custom;
      if (url.endsWith(`/api/systems/${SYSTEM}/evolutions`)) return json(201, { evolution: { ...EVOLUTION, id: "evolution.new" } });
      if (url.endsWith("/realizations")) return json(201, { realization: { id: "r.7" }, secret: "s".repeat(64) });
      if (url.endsWith("/commit")) return json(201, { commit: "c".repeat(40), parent: "a".repeat(40), tree: "t", submitted: {} });
      return json(404, { error: { code: "not-found", message: "no" } });
    }
    const u = new URL(url, "http://x");
    if (u.pathname === "/api/systems") return json(200, [{ systemId: SYSTEM, title: "Peopling", head: null }]);
    if (u.pathname.endsWith("/files")) return json(200, { ref, files: Object.keys(FILES).map((path) => ({ path, hash: path, size: FILES[path]!.length })) });
    if (u.pathname.endsWith("/file")) {
      const path = u.searchParams.get("path")!;
      if (!(path in FILES)) return json(404, { error: { code: "not-found", message: "missing" } });
      return json(200, { ref, path, hash: path, text: FILES[path], size: FILES[path]!.length, truncated: false, binary: false, nodes: path === "system.yaml" ? [SYSTEM] : [] });
    }
    if (u.pathname.endsWith("/revisions")) return json(200, { revisions: [{ id: "head", kind: "head", label: "head" }] });
    if (u.pathname.endsWith("/evolutions")) return json(200, { evolutions: [EVOLUTION], realizations: [] });
    if (u.pathname.endsWith("/model")) return json(200, fixtureBundle());
    return json(200, {});
  }));
  return calls;
}

const apiSeed = (qc: QueryClient) => qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });

async function openFile(path: string) {
  const nav = await screen.findByRole("navigation", { name: "Files" });
  const name = path.split("/").pop()!;
  fireEvent.click(await within(nav).findByRole("link", { name: new RegExp(`^${name.replace(".", "\\.")}`) }));
  await screen.findByRole("heading", { level: 2, name: path });
  await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
}

async function editCurrent(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await waitFor(() => expect(document.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("false"));
  typeInEditor(document.body, text);
}

function fillSheet(opts: { evolution?: string; token?: string } = {}) {
  const sheet = screen.getByRole("complementary", { name: "Commit" });
  fireEvent.change(within(sheet).getByLabelText("Message"), { target: { value: "Tidy the Genome" } });
  fireEvent.change(within(sheet).getByLabelText("Why"), { target: { value: "Clearer purpose" } });
  fireEvent.change(within(sheet).getByLabelText("Evolution"), { target: { value: opts.evolution ?? EVOLUTION.id } });
  fireEvent.change(within(sheet).getByLabelText("Your name"), { target: { value: "sam" } });
  if (opts.token !== "") fireEvent.change(within(sheet).getByLabelText("Admin token"), { target: { value: opts.token ?? "admin-1" } });
  return sheet;
}

beforeEach(() => localStorage.clear());

describe("Code page", () => {
  it("lists the tree from the API and shows files read-only by default", async () => {
    stubApi();
    renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    const nav = await screen.findByRole("navigation", { name: "Files" });
    expect(await within(nav).findByRole("link", { name: /^system\.yaml/ })).toBeTruthy();
    expect(within(nav).getByText("things/")).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    expect(document.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("true");
    expect(screen.getByText("read-only · canonical")).toBeTruthy();
    expect(() => typeInEditor(document.body, "x")).toThrow(/read-only/);
    // Each mapped node can start a described change anchored on it.
    const nodes = screen.getByRole("list", { name: "Model nodes in this file" });
    expect(within(nodes).getByRole("link", { name: /^Describe a change/ }).getAttribute("href")).toBe(
      `/s/${SYSTEM}/r/head/work?panel=intent&anchor=${SYSTEM}`,
    );
  });

  it("puts an edit in the draft: pending 1 and a ● on the file", async () => {
    stubApi();
    renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    await editCurrent("name: KiT\n");
    expect(await screen.findByText("editing · 1 pending")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Files" });
    expect(within(nav).getByRole("link", { name: /^system\.yaml.*modified/ })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Pending files" })).getAllByRole("listitem")).toHaveLength(1);
  });

  it("commits two edits and one delete in one body, with the exact start-work body and Bearer, then opens Work", async () => {
    const calls = stubApi();
    const fx = vi.fn();
    window.addEventListener("artyfact:fx", fx);
    const { router } = renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    await editCurrent("name: KiT\n");
    await openFile("purpose.yaml");
    await editCurrent("note: more\n");
    await openFile("things/webapp/thing.yaml");
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    expect(await screen.findByText("editing · 3 pending")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    const sheet = await screen.findByRole("complementary", { name: "Commit" });
    fillSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Commit" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/${SYSTEM}/r/head/work`));
    const qs = new URLSearchParams(router.state.location.search);
    expect(qs.get("evolution")).toBe(EVOLUTION.id);
    expect(qs.get("realization")).toBe("r.7");

    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.map((c) => new URL(c.url, "http://x").pathname)).toEqual([
      `/api/systems/${SYSTEM}/evolutions/${EVOLUTION.id}/realizations`,
      `/api/systems/${SYSTEM}/realizations/r.7/commit`,
    ]);
    expect(posts[0]!.body).toEqual({ agentLabel: "human:sam", target: "genome", role: "author", origin: "editor" });
    expect(posts[0]!.auth).toBe("Bearer admin-1");
    expect(posts[1]!.auth).toBe(`Bearer ${"s".repeat(64)}`);
    expect(posts[1]!.body).toEqual({
      message: "Tidy the Genome",
      why: "Clearer purpose",
      author: "sam",
      changes: [
        { path: "purpose.yaml", content: `${FILES["purpose.yaml"]}note: more\n` },
        { path: "system.yaml", content: `${FILES["system.yaml"]}name: KiT\n` },
        { path: "things/webapp/thing.yaml", content: null },
      ],
    });
    expect(fx.mock.calls.some(([e]) => (e as CustomEvent).detail.kind === "submitted")).toBe(true);
    expect(localStorage.getItem(`artyfact.draft.${SYSTEM}.genome.head`)).toBeNull();
    window.removeEventListener("artyfact:fx", fx);
  });

  it("creates the new Evolution first on the New evolution… path", async () => {
    const calls = stubApi();
    renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    await editCurrent("x: 1\n");
    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    const sheet = await screen.findByRole("complementary", { name: "Commit" });
    fillSheet({ evolution: "__new" });
    fireEvent.change(within(sheet).getByLabelText("Evolution title"), { target: { value: "Rename" } });
    fireEvent.change(within(sheet).getByLabelText("Evolution intent"), { target: { value: "Say it plainly" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(3));
    const posts = calls.filter((c) => c.method === "POST");
    expect(new URL(posts[0]!.url, "http://x").pathname).toBe(`/api/systems/${SYSTEM}/evolutions`);
    expect(posts[0]!.body).toEqual({ title: "Rename", intent: "Say it plainly", affectedNodes: [SYSTEM] });
    expect(posts[0]!.auth).toBe("Bearer admin-1");
    expect(new URL(posts[1]!.url, "http://x").pathname).toBe(`/api/systems/${SYSTEM}/evolutions/evolution.new/realizations`);
  });

  it("sends an empty affectedNodes when the changed files map to no nodes", async () => {
    const calls = stubApi();
    renderApp(`${CODE}?path=purpose.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["purpose.yaml"]));
    await editCurrent("x: 1\n");
    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    const sheet = await screen.findByRole("complementary", { name: "Commit" });
    fillSheet({ evolution: "__new" });
    fireEvent.change(within(sheet).getByLabelText("Evolution title"), { target: { value: "Rename" } });
    fireEvent.change(within(sheet).getByLabelText("Evolution intent"), { target: { value: "Say it plainly" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Commit" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")!.body).toEqual({ title: "Rename", intent: "Say it plainly", affectedNodes: [] });
  });

  it("explains a 401 and retries on the started realization without starting another", async () => {
    let commits = 0;
    const calls = stubApi((url) => {
      if (url.endsWith("/commit") && commits++ === 0) return json(401, { error: { code: "unauthorized", message: "nope" } });
      return undefined;
    });
    const { router } = renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    await editCurrent("x: 1\n");
    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    const sheet = await screen.findByRole("complementary", { name: "Commit" });
    fillSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Commit" }));
    expect((await within(sheet).findByRole("alert")).textContent).toBe("Commit needs the admin token (401). Set the admin token in the header and try again.");
    fireEvent.click(within(sheet).getByRole("button", { name: "Retry commit" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/${SYSTEM}/r/head/work`));
    const paths = calls.filter((c) => c.method === "POST").map((c) => new URL(c.url, "http://x").pathname);
    expect(paths.filter((p) => p.endsWith("/realizations"))).toHaveLength(1);
    expect(paths.filter((p) => p.endsWith("/commit"))).toHaveLength(2);
  });

  it("keeps the started realization when the sheet closes, so the retry starts no second one", async () => {
    let commits = 0;
    const calls = stubApi((url) => {
      if (url.endsWith("/commit") && commits++ === 0) return json(422, { error: { code: "protected-path", message: "system.yaml is protected" } });
      return undefined;
    });
    const { router } = renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    await editCurrent("x: 1\n");
    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    let sheet = await screen.findByRole("complementary", { name: "Commit" });
    fillSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Commit" }));
    expect((await within(sheet).findByRole("alert")).textContent).toMatch(/protected/);

    // Fix the draft: a file link closes the sheet (the Drawer unmounts).
    await openFile("purpose.yaml");
    expect(screen.queryByRole("complementary", { name: "Commit" })).toBeNull();
    await editCurrent("note: ok\n");

    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    sheet = await screen.findByRole("complementary", { name: "Commit" });
    expect(within(sheet).getByText(/Retrying on realization/)).toBeTruthy();
    expect(within(sheet).queryByLabelText("Admin token")).toBeNull();
    fireEvent.change(within(sheet).getByLabelText("Message"), { target: { value: "Second try" } });
    fireEvent.change(within(sheet).getByLabelText("Why"), { target: { value: "Fixed" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Retry commit" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/s/${SYSTEM}/r/head/work`));
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts.filter((c) => c.url.endsWith("/realizations"))).toHaveLength(1);
    const retried = posts.filter((c) => c.url.endsWith("/commit"));
    expect(retried).toHaveLength(2);
    expect(retried[1]!.auth).toBe(`Bearer ${"s".repeat(64)}`);
    expect(new URLSearchParams(router.state.location.search).get("realization")).toBe("r.7");
  });

  it("keeps the draft across a reload", async () => {
    stubApi();
    renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    await waitFor(() => expect(editorText()).toBe(FILES["system.yaml"]));
    await editCurrent("kept: yes\n");
    await screen.findByText("editing · 1 pending");
    cleanup();
    renderApp(`${CODE}?path=system.yaml`, undefined, apiSeed);
    expect(await screen.findByText("editing · 1 pending")).toBeTruthy();
    await waitFor(() => expect(editorText()).toBe(`${FILES["system.yaml"]}kept: yes\n`));
    expect(document.querySelector(".cm-content")!.getAttribute("aria-readonly")).toBe("false");
  });
});

describe("Code page in fixture mode", () => {
  it("browses the fixture Genome, edits locally, and disables Commit with its reason", async () => {
    renderApp(`${CODE}?path=node.yaml`);
    const nav = await screen.findByRole("navigation", { name: "Files" });
    // Every node directory has a node.yaml; the root's is the System's.
    const links = await within(nav).findAllByRole("link", { name: /^node\.yaml/ });
    expect(links.some((a) => a.getAttribute("href")!.endsWith("?path=node.yaml"))).toBe(true);
    await waitFor(() => expect(editorText()).toMatch(/system\.peopling/));
    await editCurrent("# local\n");
    expect(await screen.findByText("editing · 1 pending")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Commit…" }));
    const sheet = await screen.findByRole("complementary", { name: "Commit" });
    expect(within(sheet).getByRole("button", { name: "Commit" })).toHaveProperty("disabled", true);
    expect(within(within(sheet).getByRole("list", { name: "Why commit is disabled" })).getByText("Commit needs the platform API.")).toBeTruthy();
  });

  it("says the fixture has no app repo", async () => {
    renderApp(`${CODE}?repo=app`);
    expect(await screen.findByText("The fixture has no app repo.")).toBeTruthy();
  });
});
