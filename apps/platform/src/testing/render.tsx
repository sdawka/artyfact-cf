import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { afterEach, beforeEach, vi } from "vitest";
import { createRoutes } from "@/app/routes";
import { fixtureBundle } from "@/api/fixtures";
import { resetClientMode } from "@/api/client";
import { qk } from "@/api/queries";

// vitest runs without globals, so Testing Library cannot register its own cleanup.
afterEach(cleanup);
beforeEach(() => {
  resetClientMode();
  vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline in tests"))));
});
afterEach(() => vi.unstubAllGlobals());

// jsdom gaps used by cmdk / Radix.
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

export function testQueryClient() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(qk.model("system.keep-in-touch", "head"), fixtureBundle());
  return qc;
}

/**
 * Renders the real route table (or `routes`) at `url` with the fixture bundle preloaded.
 * `seed` can put more data in the cache first (e.g. `qc.setQueryData(qk.evaluations(id), ...)`).
 */
export function renderApp(url: string, routes?: RouteObject[], seed?: (qc: QueryClient) => void) {
  const qc = testQueryClient();
  seed?.(qc);
  const router = createMemoryRouter(routes ?? createRoutes(qc), { initialEntries: [url] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router, qc };
}
