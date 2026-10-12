import type { QueryClient } from "@tanstack/react-query";
import { isRouteErrorResponse, Link, Navigate, redirect, useLocation, useParams, useRouteError, type RouteObject } from "react-router";
import { modelQuery, useModelBundle } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { OrbLoader } from "@/components/OrbLoader/OrbLoader";
import { VIEWS, type ViewName } from "@/model/kinds";
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
  if (!data) return <OrbLoader label="Loading model…" />;
  return (
    <ModelProvider bundle={data}>
      <Shell />
    </ModelProvider>
  );
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
    { path: "/style", element: <StylePage /> },
    { path: "/s/:systemId", loader: ({ params }) => redirect(viewPath(params.systemId!, DEFAULT_REV, "overview")) },
    {
      path: "/s/:systemId/r/:rev",
      loader: async ({ params }) => {
        await queryClient.ensureQueryData(modelQuery(params.systemId!, params.rev!));
        return null;
      },
      // Search-param changes (focus, layer, ...) must not refetch the bundle.
      shouldRevalidate: ({ currentParams, nextParams }) =>
        currentParams.systemId !== nextParams.systemId || currentParams.rev !== nextParams.rev,
      element: <SystemLayout />,
      errorElement: <RouteError />,
      hydrateFallbackElement: <OrbLoader label="Loading model…" />,
      children: [
        { index: true, loader: ({ params }) => redirect(viewPath(params.systemId!, params.rev!, "overview")) },
        { path: "history", element: <HistoryRedirect /> },
        ...VIEWS.map((view) => ({
          path: view,
          lazy: async () => ({ Component: (await viewModules[view]()).default }),
        })),
      ],
    },
    { path: "*", element: <RouteError /> },
  ];
}
