import { LAYERS, useSelection, type Layer } from "@/model/useSelection";

const LABELS: Record<Layer, string> = { genome: "Genome", proteome: "Proteome", phenome: "Phenome" };

/** Genome · Proteome · Phenome over the same subjects; writes `?layer=`. */
export function LayerSwitch() {
  const { layer, setLayer } = useSelection();
  return (
    <div className="u-segments" role="tablist" aria-label="Layer">
      {LAYERS.map((l) => (
        <button key={l} type="button" role="tab" aria-selected={l === layer} onClick={() => setLayer(l)}>
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
