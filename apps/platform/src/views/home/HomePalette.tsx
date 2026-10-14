import { useEffectsPreference } from "@/effects/effectsPreference";
import type { RefObject } from "react";
import { useNavigate } from "react-router";
import { OPEN_ADMIN_TOKEN_EVENT } from "@/app/AdminTokenControl";
import { PaletteFooter, PaletteFrame, PaletteGroup, PaletteItem, paletteScore } from "@/app/CommandPalette";
import type { PartSummary, SystemSummary } from "../../../shared/api";

/** Ctrl/⌘ K on Home and Part pages: the shared palette with Systems, shared Parts and global actions. Home has no System model. */
export function HomePalette({ open, onOpenChange, systems, parts, returnFocus, retry }: {
  returnFocus?: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpenChange(open: boolean): void;
  systems: readonly SystemSummary[];
  parts: readonly PartSummary[];
  /** Offered as an action only in fixture mode. */
  retry?: () => void;
}) {
  const navigate = useNavigate();
  const effects = useEffectsPreference();
  const go = (to: string) => {
    onOpenChange(false);
    void navigate(to);
  };
  return (
    <PaletteFrame open={open} onOpenChange={onOpenChange} placeholder="Go to a System, Part or action…" footer={<PaletteFooter />}
      onCloseAutoFocus={(event) => { event.preventDefault(); const target = returnFocus?.current; (target?.isConnected ? target : document.getElementById("main"))?.focus(); }}>
      {(query) => {
        const sys = systems.filter((s) => paletteScore(query, [s.systemId, s.title]) > 0);
        const shared = parts.filter((p) => p.scope.kind === "shared" && paletteScore(query, [`${p.partId}@${p.version}`, p.name || p.partId]) > 0);
        const actions = [
          { id: "admin", label: "Admin token…", keywords: ["admin", "token", "auth"], run: () => { onOpenChange(false); window.dispatchEvent(new Event(OPEN_ADMIN_TOKEN_EVENT)); } },
          ...(retry ? [{ id: "retry", label: "Retry API", keywords: ["retry", "api", "fixture"], run: () => { onOpenChange(false); retry(); } }] : []),
          { id: "effects", label: effects.enabled ? "Effects: turn off" : "Effects: turn on", keywords: ["effects", "ambient", "animation", "motion"], run: () => { onOpenChange(false); effects.toggle(); } },
        ].filter((a) => paletteScore(query, [a.label, ...a.keywords]) > 0);
        return <>
          {sys.length > 0 && <PaletteGroup heading="Systems">
            {sys.map((s) => <PaletteItem key={s.systemId} value={`system ${s.systemId}`} name={s.title || s.systemId} id={s.systemId} onSelect={() => go(`/s/${encodeURIComponent(s.systemId)}`)} />)}
          </PaletteGroup>}
          {shared.length > 0 && <PaletteGroup heading="Shared Parts">
            {shared.map((p) => <PaletteItem key={`${p.partId}@${p.version}`} value={`part ${p.partId}@${p.version}`} name={p.name || p.partId} id={`${p.partId}@${p.version}`}
              onSelect={() => go(`/parts/${encodeURIComponent(p.partId)}/${encodeURIComponent(p.version)}`)} />)}
          </PaletteGroup>}
          {actions.length > 0 && <PaletteGroup heading="Actions">
            {actions.map((a) => <PaletteItem key={a.id} value={`action.${a.id}`} name={a.label} onSelect={a.run} />)}
          </PaletteGroup>}
        </>;
      }}
    </PaletteFrame>
  );
}
