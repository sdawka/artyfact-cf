import { useEffect, useState } from "react";
import { Drawer } from "@/components/Drawer/Drawer";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Tabs } from "@/components/Tabs/Tabs";
import { useModel } from "@/model/useModel";
import { useSelection } from "@/model/useSelection";
import { InspectorHeader } from "./InspectorHeader";
import { INSPECTOR_TABS, TAB_COMPONENTS, type InspectorTab } from "./tabs";
import styles from "./Inspector.module.css";

const WIDTH_KEY = "artyfact.inspector.width";
const readWidth = () => {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return n >= 280 && n <= 720 ? n : 380;
  } catch {
    return 380;
  }
};

/** Right-hand Inspector; open iff `?focus=` is set. */
export function InspectorDrawer() {
  const { focusId, clear } = useSelection();
  const m = useModel();
  const [width, setWidth] = useState(readWidth);
  const [tab, setTab] = useState<InspectorTab>("what");
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // storage unavailable; width stays per-session
    }
  }, [width]);

  const entry = focusId ? m.byId(focusId) : undefined;
  const Body = TAB_COMPONENTS[tab];
  return (
    <Drawer open={!!focusId} label="Inspector" width={width} onWidthChange={setWidth}>
      {entry ? (
        <div className={styles.inspector}>
          <InspectorHeader entry={entry} />
          <Tabs<InspectorTab> tabs={INSPECTOR_TABS} value={tab} onChange={setTab} label="Inspector sections">
            <Body entry={entry} />
          </Tabs>
        </div>
      ) : (
        <EmptyState
          title={`Nothing in this revision has the id ${focusId ?? ""}.`}
          action={<button type="button" className={`u-brackets ${styles.close}`} onClick={clear}>Close</button>}
        />
      )}
    </Drawer>
  );
}
