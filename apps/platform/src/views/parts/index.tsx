import { Button } from "@/components/ui";
import { Link, useParams } from "react-router";
import { ApiRequestError } from "@/api/client";
import { usePart } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { EntryLayout } from "@/components/EntryLayout/EntryLayout";
import { LoadingState } from "@/components/LoadingState/LoadingState";
import { PageHeader, ScopePath } from "@/components/PageHeader/PageHeader";
import { HomeHeader } from "@/views/home/HomeHeader";
import { PartContents, PartMeta } from "./PartContents";
import styles from "./parts.module.css";

/** Public, read-only inspection of one immutable shared Part version. */
export default function PartDetail() {
  const { partId = "", version = "" } = useParams();
  const query = usePart(partId, version);
  const crumbs = (name: string) => <ScopePath label="Part breadcrumb" crumbs={[{ label: "Home", to: "/" }, { label: "Shared Parts", to: "/#parts" }, { label: name }]} />;
  if (query.isLoading) return <EntryLayout header={<HomeHeader />}><PageHeader title="Part" context={crumbs(partId)} /><LoadingState label="Loading Part…" /></EntryLayout>;
  if (query.isError || !query.data) {
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <EntryLayout header={<HomeHeader />}>
        <PageHeader title={missing ? "Part not found" : "This Part could not be loaded."} context={crumbs(partId)} />
        <EmptyState
          kind="error"
          title={missing ? `${partId}@${version} was not found.` : `Could not load ${partId}@${version}.`}
          action={<span className={styles.actions}><Button asChild variant="primary"><Link to="/">Open Home</Link></Button>{!missing && <Button onClick={() => void query.refetch()}>Try again</Button>}</span>}
        />
      </EntryLayout>
    );
  }
  const part = query.data.part;
  const pkg = part.package;
  return (
    <EntryLayout header={<HomeHeader />}>
      <div className={styles.reading}>
        <PageHeader title={pkg.name || pkg.id} purpose={pkg.description || "No description."} context={crumbs(pkg.name || pkg.id)}>
          <PartMeta part={part} />
        </PageHeader>
        <p className={styles.quiet}>A saved package version, read-only here. Author and upgrade Parts with the CLI or an agent.</p>
        <PartContents part={part} />
      </div>
    </EntryLayout>
  );
}
