import type { QueryClient } from "@tanstack/react-query";
import { isRouteErrorResponse, Link, Navigate, redirect, useLocation, useParams, useRouteError, type RouteObject } from "react-router";
import { modelQuery, useModelBundle } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { LoadingState } from "@/components/LoadingState/LoadingState";
import { loadKindViews, VIEWS, type ViewName } from "@/model/kinds";
import { ModelProvider } from "@/model/useModel";
import { DEFAULT_REV, viewPath } from "@/model/useSelection";
import { Shell } from "./Shell";
import { StylePage } from "./StylePage";
import styles from "./Shell.module.css";

type ViewModule = { default: React.ComponentType };

/** Each view is `src/views/<name>/index.tsx` with a default-exported component, loaded lazily. */
export const viewModules: Record<ViewName, () => Promise<ViewModule>> = {
  overview: () => import("@/views/overview"),
  map: () => import("@/views/map"),
  journeys: () => import("@/views/journeys"),
  theory: () => import("@/views/theory"),
  code: () => import("@/views/code"),
  work: () => import("@/views/work"),
  evaluations: () => import("@/views/evaluations"),
  changelog: () => import("@/views/changelog"),
  compare: () => import("@/views/compare"),
  phenome: () => import("@/views/phenome"),
};

/**
 * `…/history` was renamed to `…/changelog`; old links keep their search params (`?commit=`, `?evolution=`) and hash.
 * A component, not a loader: loader requests never carry the URL fragment.
 */
function HistoryRedirect() {
  const { systemId, rev } = useParams();
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname: viewPath(systemId!, rev!, "changelog"), search, hash }} />;
}

function SystemLayout() {
  const { data, error } = useModelBundle();
  if (error) throw error;
  if (!data) return <LoadingState label="Loading model…" />;
  return (
    <ModelProvider bundle={data}>
      <Shell />
    </ModelProvider>
  );
}

/** A System with one Thing starts at that Thing; multi-Thing Systems retain their explicit overview. */
async function systemEntry(queryClient: QueryClient, systemId: string, rev: string) {
  const bundle = await queryClient.ensureQueryData(modelQuery(systemId, rev));
  const things = bundle.model.things ?? [];
  return things.length === 1
    ? redirect(`/s/${encodeURIComponent(systemId)}/r/${encodeURIComponent(rev)}/things/${encodeURIComponent(things[0]!.id)}`)
    : redirect(viewPath(systemId, rev, "overview"));
}

function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : "unknown error";
  return (
    <main className={styles.errorPage}>
      <EmptyState
        title="This System could not be loaded."
        action={<Link className="u-marker" to="/">Open Home</Link>}
      >
        <code>{message}</code>
      </EmptyState>
    </main>
  );
}

/** Route table. A function of the QueryClient so loaders can prefetch the model bundle. */
export function createRoutes(queryClient: QueryClient): RouteObject[] {
  return [
    { path: "/", lazy: async () => ({ Component: (await import("@/views/home")).default }), errorElement: <RouteError /> },
    { path: "/parts/:partId/:version", lazy: async () => ({ Component: (await import("@/views/parts")).default }), errorElement: <RouteError /> },
    { path: "/style", element: <StylePage /> },
    { path: "/s/:systemId", loader: ({ params }) => systemEntry(queryClient, params.systemId!, DEFAULT_REV) },
    {
      path: "/s/:systemId/r/:rev",
      loader: async ({ params }) => {
        await Promise.all([queryClient.ensureQueryData(modelQuery(params.systemId!, params.rev!)), loadKindViews()]);
        return null;
      },
      // Search-param changes (focus, layer, ...) must not refetch the bundle.
      shouldRevalidate: ({ currentParams, nextParams }) =>
        currentParams.systemId !== nextParams.systemId || currentParams.rev !== nextParams.rev,
      element: <SystemLayout />,
      errorElement: <RouteError />,
      hydrateFallbackElement: <LoadingState label="Loading model…" />,
      children: [
        { index: true, loader: ({ params }) => systemEntry(queryClient, params.systemId!, params.rev!) },
        { path: "history", element: <HistoryRedirect /> },
        { path: "parts", lazy: async () => ({ Component: (await import("@/views/parts/SystemParts")).default }) },
        { path: "things/:thingId", lazy: async () => ({ Component: (await import("@/views/things/ThingBoundary")).default }), children: [
          { index: true, lazy: async () => ({ Component: (await import("@/views/things")).default }) },
          ...VIEWS.map((view) => ({ path: view, lazy: async () => ({ Component: view === "overview" ? (await import("@/views/things")).default : (await viewModules[view]()).default }) })),
        ] },
        ...VIEWS.map((view) => ({
          path: view,
          lazy: async () => ({ Component: (await viewModules[view]()).default }),
        })),
      ],
    },
    { path: "*", element: <RouteError /> },
  ];
}
