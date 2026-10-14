import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Drawer } from "@/components/Drawer/Drawer";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Tabs } from "@/components/Tabs/Tabs";
import { useModel } from "@/model/useModel";
import { useSearchParams } from "react-router";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import { InspectorHeader } from "./InspectorHeader";
import { useTabComponent } from "./tabRegistry";
import { INSPECTOR_TABS, type InspectorTab } from "./tabs";
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
      container.current?.querySelector<HTMLElement>("[data-inspector-title]")?.focus();
    }
    if (!closed) return;
    const target = returnTo.current?.isConnected ? returnTo.current : document.getElementById("main");
    returnTo.current = null;
    target?.focus();
  }, [open]);
  useEffect(() => {
    const active = document.activeElement;
    if (open && (!active || active === document.body || !active.isConnected)) {
      container.current?.querySelector<HTMLElement>("[data-inspector-title]")?.focus();
    }
  }, [open, focusId]);

  const entry = focusId ? m.byId(focusId) : undefined;
  const Body = useTabComponent(tab);
  return (
    <Drawer open={open} label="Inspector" width={width} onWidthChange={setWidth}>
      <div ref={container} className={styles.inspector}>
        {entry ? (
          <>
            <InspectorHeader entry={entry} onClose={close} />
            <Tabs<InspectorTab> tabs={INSPECTOR_TABS} value={tab} onChange={setTab} label="Inspector sections">
              <Body entry={entry} />
            </Tabs>
          </>
        ) : (
          <EmptyState
            title={`Nothing in this revision has the id ${focusId ?? ""}.`}
            action={
              <button type="button" className={`u-brackets ${styles.close}`} onClick={close} data-inspector-title>
                Close
              </button>
            }
          />
        )}
      </div>
    </Drawer>
  );
}
