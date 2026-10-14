import { Tabs } from "@/components/Tabs/Tabs";
import styles from "./LayerSwitch.module.css";
import { LAYERS, useSelection, type Layer } from "@/model/useSelection";

const TABS = LAYERS.map((id) => ({ id, label: { genome: "Genome", proteome: "Proteome", phenome: "Phenome" }[id] }));

/** "Overlay": Genome · Proteome · Phenome over the same subjects; writes `?layer=`. Roving tabindex and arrow keys via Tabs. */
export function LayerSwitch() {
  const { layer, setLayer } = useSelection();
  return (
    <div className={styles.layers}>
      <span aria-hidden="true" className={styles.label}>Overlay</span>
      <Tabs<Layer> tabs={TABS} value={layer} onChange={setLayer} label="Overlay" />
    </div>
  );
}
