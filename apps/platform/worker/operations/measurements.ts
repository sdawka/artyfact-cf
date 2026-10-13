import type { PhenomeEvent } from "../../shared/api";
import type { CustomMeasurement, OperationsWindow } from "../../shared/operations";
import { validateMeasurement } from "./validation";
/** Only authenticated, stored event headers provide attribution. Never accept payload lineage. */
export function aggregateMeasurements(events: PhenomeEvent[], bindingId: string, window: OperationsWindow): CustomMeasurement[] {
  const from = Date.parse(window.from), to = Date.parse(window.to);
  return events.flatMap(e => {
    const at = Date.parse(e.emittedAt);
    if (e.kind !== "measurement" || e.artifactId !== bindingId || !Number.isFinite(at) || at < from || at > to) return [];
    let payload; try { payload = validateMeasurement(e.payload); } catch { return []; }
    return [{ ...payload, emittedAt: e.emittedAt, receivedAt: e.receivedAt, seq: e.seq, thingId: e.thingId, artifactId: e.artifactId, buildId: e.buildId, commit: e.commit, ...(e.outputId && { outputId: e.outputId }), ...(e.genomeCommit && { genomeCommit: e.genomeCommit }), ...(e.deploymentId && { deploymentId: e.deploymentId }) }];
  });
}
