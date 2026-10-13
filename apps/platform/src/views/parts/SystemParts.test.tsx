import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";

const PATH = "/s/system.keep-in-touch/r/head/parts";
const part = { package: { id: "part.private", version: "1.0.0", name: "Private logic", visibility: "system-private", systemId: "system.keep-in-touch", published: true, inputs: [], payload: { model: {}, files: {} }, commands: [{ id: "build", run: "echo must-not-run", purpose: "Compile" }] }, scope: { kind: "system", systemId: "system.keep-in-touch" }, digest: "sha256:private", publishedAt: "2026-10-12T12:00:00Z" };
const unlock = async () => {
  fireEvent.change(await screen.findByLabelText("Admin token"), { target: { value: "admin-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Load private Parts" }));
};

describe("System-private Parts", () => {
  it("shows loading and recoverable connection errors", async () => {
    let reject: (reason: Error) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (!url.includes("/parts")) return Promise.reject(new Error("offline"));
      return new Promise<Response>((_resolve, fail) => { reject = fail; });
    }));
    renderApp(PATH);
    await unlock();
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Loading private Parts…");
    expect(screen.getByRole("button", { name: "Load private Parts" })).toHaveProperty("disabled", true);
    reject(new Error("Connection lost"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/connection/));
    expect(screen.getByRole("button", { name: "Load private Parts" })).toHaveProperty("disabled", false);
  });

  it("requires credentials then inspects a pinned private package without executing commands", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.includes("/parts")) throw new Error("offline");
      if (new Headers(init?.headers).get("authorization") !== "Bearer admin-secret") return new Response('{"error":{"code":"unauthorized","message":"Unauthorized"}}', { status: 401 });
      return Response.json(url.endsWith("/parts") ? { parts: [{ partId: "part.private", version: "1.0.0", name: "Private logic", scope: part.scope, digest: part.digest, publishedAt: part.publishedAt, dependencies: [] }] } : { part });
    }));
    renderApp(PATH);
    expect(await screen.findByText(/Enter an admin token to inspect/)).toBeTruthy();
    await unlock();
    fireEvent.click(await screen.findByRole("button", { name: "Private logic 1.0.0" }));
    expect(await screen.findByRole("heading", { name: "Pinned payload" })).toBeTruthy();
    expect(screen.getByText(/echo must-not-run/)).toBeTruthy();
  });

  it("explains an unauthorized private read without exposing package data", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("/parts")) throw new Error("offline");
      return new Response('{"error":{"code":"unauthorized","message":"Unauthorized"}}', { status: 401 });
    }));
    renderApp(PATH);
    await unlock();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringMatching(/not authorized/));
    expect(screen.queryByText("Private logic")).toBeNull();
  });

  it("shows an empty authorized catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (!url.includes("/parts")) throw new Error("offline");
      return Response.json({ parts: [] });
    }));
    renderApp(PATH);
    await unlock();
    expect(await screen.findByText("No private Parts in this System.")).toBeTruthy();
  });
});
