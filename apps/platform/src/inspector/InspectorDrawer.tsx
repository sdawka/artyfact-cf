import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Drawer } from "@/components/Drawer/Drawer";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Kbd } from "@/components/Kbd/Kbd";
import { Button } from "@/components/ui";
import { Tabs } from "@/components/Tabs/Tabs";
import { titleOf, useKindViews } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useSearchParams } from "react-router";
import type { IndexEntry } from "@/model/index";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import { InspectorHeader } from "./InspectorHeader";
import { useTabComponent } from "./tabRegistry";
import { INSPECTOR_TABS, useTabCounts, type InspectorTab } from "./tabs";
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

/** Map opens Details explicitly; other views inspect their focused object automatically. */
export function InspectorDrawer() {
  const { focusId, clear } = useSelection();
  const { view } = useSystemRoute();
  const [params] = useSearchParams();
  const { closeDetails } = useAtlasNavigation();
  const close = view === "map" ? closeDetails : clear;
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

  const container = useRef<HTMLDivElement>(null);
  // The node name is the focus target: the drawer's h2, or the bottom sheet's aside (its title is the sheet's own heading).
  const titleTarget = () => container.current?.querySelector<HTMLElement>("[data-inspector-title]") ?? container.current?.closest<HTMLElement>("[data-inspector-title]") ?? null;
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const open = !!focusId && (view !== "map" || params.get("inspect") === "1");

  // Focus management (non-modal): on open remember where focus was and move it to the title;
  // when the focused node changes and focus was lost (e.g. the clicked chip unmounted), refocus
  // the title; on close restore focus to where it was before opening, else to <main>.
  useLayoutEffect(() => {
    const opened = open && !wasOpen.current;
    const closed = !open && wasOpen.current;
    wasOpen.current = open;
    if (opened) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body) returnTo.current = active;
      titleTarget()?.focus();
    }
    if (!closed) return;
    const target = returnTo.current?.isConnected ? returnTo.current : document.getElementById("main");
    returnTo.current = null;
    target?.focus();
  }, [open]);
  useEffect(() => {
    const active = document.activeElement;
    if (open && (!active || active === document.body || !active.isConnected)) {
      titleTarget()?.focus();
    }
  }, [open, focusId]);

  const entry = focusId ? m.byId(focusId) : undefined;
  const kinds = useKindViews();
  return (
    <Drawer open={open} label="Inspector" title={entry ? titleOf(entry, kinds.of(entry.kind)) : "Inspector"} closeLabel="Close inspector" width={width} onWidthChange={setWidth} onClose={close}>
      <div ref={container} className={styles.inspector}>
        {entry ? (
          <InspectorContent entry={entry} tab={tab} setTab={setTab} close={close} />
        ) : (
          <div className={styles.empty}>
            <EmptyState
              title={`Nothing in this revision has the id ${focusId ?? ""}.`}
              action={<Button onClick={close} data-inspector-title>Close</Button>}
            />
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** Header, tab row with inventory counts, the active tab's body, and the keyboard hint (shown while the drawer has focus). */
function InspectorContent({ entry, tab, setTab, close }: { entry: IndexEntry; tab: InspectorTab; setTab(tab: InspectorTab): void; close(): void }) {
  const Body = useTabComponent(tab);
  const counts = useTabCounts(entry);
  const tabs = INSPECTOR_TABS.map((t) => (counts[t.id] === undefined ? t : { ...t, count: counts[t.id] }));
  return (
    <>
      <InspectorHeader entry={entry} onClose={close} />
      <div className={styles.tabsWrap}>
        <Tabs<InspectorTab> tabs={tabs} value={tab} onChange={setTab} label="Inspector sections">
          <Body entry={entry} />
        </Tabs>
      </div>
      <div className={styles.hint} aria-hidden="true">
        <span><Kbd keys={["Esc"]} /> close</span>
        <span><Kbd keys={["["]} /> <Kbd keys={["]"]} /> siblings</span>
      </div>
    </>
  );
}
