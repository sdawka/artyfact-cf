import { Link, Outlet, useParams } from "react-router";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useModel } from "@/model/useModel";
import { useSystemRoute, viewPath } from "@/model/useSelection";

export default function ThingBoundary() {
  const { thingId } = useParams();
  const { systemId, rev } = useSystemRoute();
  const { bundle } = useModel();
  return bundle.model.things.some((thing) => thing.id === thingId) ? <Outlet /> : <EmptyState title="This Thing is not in the selected System revision." action={<Link className="u-marker" to={viewPath(systemId, rev, "overview")}>Open System overview</Link>} />;
}
