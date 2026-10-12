import type { QueryClient } from "@tanstack/react-query";
import { isRouteErrorResponse, Link, redirect, useRouteError, type RouteObject } from "react-router";
import { modelQuery, useModelBundle } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { OrbLoader } from "@/components/OrbLoader/OrbLoader";
import { VIEWS, type ViewName } from "@/model/kinds";
import { ModelProvider } from "@/model/useModel";
import { DEFAULT_REV, DEFAULT_SYSTEM_ID, viewPath } from "@/model/useSelection";
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
  work: () => import("@/views/work"),
  evaluations: () => import("@/views/evaluations"),
  history: () => import("@/views/history"),
};

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
        action={<Link className="u-marker" to={viewPath(DEFAULT_SYSTEM_ID, DEFAULT_REV, "overview")}>Open Keep in Touch</Link>}
      >
        <code>{message}</code>
      </EmptyState>
    </main>
  );
}

/** Route table. A function of the QueryClient so loaders can prefetch the model bundle. */
export function createRoutes(queryClient: QueryClient): RouteObject[] {
  return [
    { path: "/", loader: () => redirect(viewPath(DEFAULT_SYSTEM_ID, DEFAULT_REV, "overview")) },
    { path: "/style", element: <StylePage /> },
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
        ...VIEWS.map((view) => ({
          path: view,
          lazy: async () => ({ Component: (await viewModules[view]()).default }),
        })),
      ],
    },
    { path: "*", element: <RouteError /> },
  ];
}
