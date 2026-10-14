import { useEffect } from "react";
import { isRouteErrorResponse, Link, useLocation, useParams, useRouteError } from "react-router";
import { EntryLayout } from "@/components/EntryLayout/EntryLayout";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Button } from "@/components/ui";
import { HomeHeader } from "@/views/home/HomeHeader";
import styles from "./EntryErrors.module.css";

/** A lazy route chunk that is gone: the app was deployed since this page loaded. */
const CHUNK_FAILURE = /dynamically imported module|importing a module script failed|loading chunk|failed to fetch dynamically/i;

const openHome = (variant: "primary" | "secondary") => <Button asChild variant={variant}><Link to="/">Open Home</Link></Button>;

/** Move focus to the h1 so the failure is announced and the keyboard starts at the page. */
function useTitleFocus() {
  useEffect(() => { document.getElementById("view-title")?.focus(); }, []);
}

/** `*`: the URL matches nothing. Not an error; no cause line and no alert. */
export function NotFound() {
  const { pathname } = useLocation();
  useTitleFocus();
  return (
    <EntryLayout header={<HomeHeader />}>
      <PageHeader title="Page not found" context={null} primary={openHome("primary")} purpose={<>Nothing lives at <code className={styles.path}>{pathname}</code>.</>} />
      <p className={styles.links}><Link to="/start">Start a System</Link></p>
    </EntryLayout>
  );
}

/** Cause of a failed load, or nothing when the thrown value says nothing useful. */
function cause(err: unknown): string | undefined {
  if (isRouteErrorResponse(err)) return `${err.status} ${err.statusText}`.trim();
  if (err instanceof Error && err.message) return err.message;
  return undefined;
}

/** `errorElement`: a route threw while loading. Says what failed, the cause when known, and what to do. */
export function RouteErrorPage() {
  const err = useRouteError();
  const { systemId } = useParams();
  useTitleFocus();
  const stale = err instanceof Error && CHUNK_FAILURE.test(err.message);
  const detail = stale ? "The app was updated. Reload to continue." : cause(err);
  return (
    <EntryLayout header={<HomeHeader />}>
      <PageHeader
        title={systemId ? "This System could not be loaded." : "This page could not be loaded."}
        context={null}
        primary={<Button variant="primary" onClick={() => window.location.reload()}>{stale ? "Reload" : "Try again"}</Button>}
        secondary={openHome("secondary")}
      />
      {detail && <p role="alert" className={styles.cause}>{stale ? detail : <code>{detail}</code>}</p>}
    </EntryLayout>
  );
}
