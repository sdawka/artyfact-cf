import { Tabs } from "@/components/Tabs/Tabs";
import { LAYERS, useSelection, type Layer } from "@/model/useSelection";

const TABS = LAYERS.map((id) => ({ id, label: { genome: "Genome", proteome: "Proteome", phenome: "Phenome" }[id] }));

/** Genome · Proteome · Phenome over the same subjects; writes `?layer=`. Roving tabindex and arrow keys via Tabs. */
export function LayerSwitch() {
  const { layer, setLayer } = useSelection();
  return <Tabs<Layer> tabs={TABS} value={layer} onChange={setLayer} label="Layer" />;
}
