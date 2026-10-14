import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Command } from "cmdk";
import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Kbd } from "@/components/Kbd/Kbd";
import { Count } from "@/components/Count/Count";
import { useEffectsPreference } from "@/effects/effectsPreference";
import { bestViewFor, GO_KEYS, kindColour, titleOf, useKindViews, VIEWS, VIEW_GROUPS, VIEW_LABELS, VIEW_KINDS, type ViewName } from "@/model/kinds";
import { canDescribeChange } from "@/inspector/InspectorHeader";
import { useModel } from "@/model/useModel";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { useReviewCount } from "@/model/useReviewCount";
import { useKeepParams, useSelection, useSystemRoute } from "@/model/useSelection";
import { OPEN_ADMIN_TOKEN_EVENT } from "./AdminTokenControl";
import { useRetryApi } from "./useRetryApi";
import styles from "./CommandPalette.module.css";

/** Views in rail order, then Compare (which has no rail row, only `g x`). */
const RAIL_ORDER: ViewName[] = [...VIEW_GROUPS.flatMap((g) => g.views), ...VIEWS.filter((v) => !VIEW_GROUPS.some((g) => g.views.includes(v)))];

/** How many nodes the Nodes group shows at once (best matches first). */
export const PALETTE_NODE_LIMIT = 50;

/** Rank `texts` against a query: 0 = no match. Every word of the query must appear; ids and names starting with it rank first. */
export function paletteScore(query: string, texts: readonly (string | undefined)[]): number {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const hay = texts.filter((t): t is string => !!t).map((t) => t.toLowerCase());
  const [id = "", name = ""] = hay;
  const whole = words.join(" ");
  let score = 0;
  for (const w of words) {
    if (!hay.some((t) => t.includes(w))) return 0;
    score += id === w ? 100 : name === w ? 80 : id.startsWith(w) ? 50 : name.startsWith(w) ? 40 : id.includes(w) ? 20 : name.includes(w) ? 15 : 5;
  }
  if (id === whole) score += 100;
  return score;
}

/** One palette row: kind glyph, name, and the right-hand slot (id, go-key, count). On narrow screens the id sits under the name. */
export function PaletteItem({ value, keywords, onSelect, glyph, glyphStyle, name, id, trail }: {
  value: string; keywords?: string[]; onSelect(): void; glyph?: ReactNode; glyphStyle?: React.CSSProperties; name: ReactNode; id?: string; trail?: ReactNode;
}) {
  return (
    <Command.Item value={value} keywords={keywords} className={styles.item} onSelect={onSelect}>
      {glyph !== undefined && <span className={styles.glyph} style={glyphStyle} aria-hidden="true">{glyph}</span>}
      <span className={styles.main}>
        <span className={styles.name}>{name}</span>
        {id && <code className={styles.idLine}>{id}</code>}
      </span>
      {id && <code className={styles.id}>{id}</code>}
      {trail && <span className={styles.trail}>{trail}</span>}
    </Command.Item>
  );
}

export function PaletteGroup({ heading, children }: { heading: string; children: ReactNode }) {
  return <Command.Group heading={heading} className={styles.group}>{children}</Command.Group>;
}

/** The hint line under the list: `↑ ↓ move   Enter open   Esc close`, plus `[ ] siblings` when a node is focused. */
export function PaletteFooter({ siblings = false }: { siblings?: boolean }) {
  return (
    <div className={styles.footer} aria-hidden="true">
      <span><Kbd keys={["↑"]} /> <Kbd keys={["↓"]} /> move</span>
      <span><Kbd keys={["Enter"]} /> open</span>
      <span><Kbd keys={["Esc"]} /> close</span>
      {siblings && <span><Kbd keys={["["]} /> <Kbd keys={["]"]} /> siblings</span>}
    </div>
  );
}

/**
 * The one palette frame (Shell and Home share it): an overlay dialog named "Go to", a search input, a list the caller fills
 * with groups for the current query (it filters and ranks itself), and a keyboard footer.
 */
export function PaletteFrame({ open, onOpenChange, placeholder, footer, children, onCloseAutoFocus }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  placeholder: string;
  footer?: ReactNode;
  /**
   * Groups for the current query. `closeThen(run)` closes the palette and runs `run` once it has closed, instead of the
   * palette's focus restore: an action that opens another overlay (the admin token popover) would otherwise be closed
   * again by that focus move.
   */
  children(query: string, closeThen: (run: () => void) => void): ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const effects = useEffectsPreference();
  const [query, setQuery] = useState("");
  const afterClose = useRef<(() => void) | null>(null);
  const closeThen = (run: () => void) => { afterClose.current = run; setQuery(""); onOpenChange(false); };
  const off = !effects.enabled;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) setQuery(""); onOpenChange(next); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={`${styles.overlay} ${off ? styles.motionOff : ""}`} />
        <DialogPrimitive.Content aria-describedby={undefined} data-effects={effects.enabled ? "on" : "off"} className={`${styles.content} ${off ? styles.motionOff : ""}`}
          onCloseAutoFocus={(event) => {
            const run = afterClose.current;
            afterClose.current = null;
            if (!run) return onCloseAutoFocus?.(event);
            event.preventDefault();
            run();
          }}>
          <DialogPrimitive.Title className="sr-only">Go to</DialogPrimitive.Title>
          <Command vimBindings={false} shouldFilter={false} label="Go to" className={styles.dialog} data-effects={effects.enabled ? "on" : "off"}>
            <Command.Input className={styles.input} placeholder={placeholder} value={query} onValueChange={setQuery} />
            <Command.List className={styles.list}>
              <Command.Empty className={styles.empty}>
                {query.trim() ? <>Nothing matches “{query.trim()}”. Try a name or an id such as <code>thing.webapp</code>.</> : "Nothing to show."}
              </Command.Empty>
              {children(query, closeThen)}
            </Command.List>
          </Command>
          {footer}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Ctrl/⌘ K inside a System: views (with their go-keys), nodes by name or id, actions. Enter opens the best view for a node. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { index, byId, bundle } = useModel();
  const { focusId, setFocus } = useSelection();
  const atlas = useAtlasNavigation();
  const { view } = useSystemRoute();
  const views = useKindViews();
  const effects = useEffectsPreference();
  const navigate = useNavigate();
  const href = useKeepParams();
  const reviewCount = useReviewCount();
  const retry = useRetryApi();
  const fixture = bundle.source === "fixture";
  const focused = focusId ? byId(focusId) : undefined;
  const anchor = focused && canDescribeChange(focused) ? focused : undefined;
  const close = () => onOpenChange(false);
  const go = (to: string) => { close(); void navigate(to); };

  return (
    <PaletteFrame open={open} onOpenChange={onOpenChange} placeholder="Go to a view, node or action…" footer={<PaletteFooter siblings={!!focusId} />}>
      {(query, closeThen) => {
        const viewRows = RAIL_ORDER.filter((v) => !VIEW_KINDS[v] || views.declares(VIEW_KINDS[v]!))
          .filter((v) => paletteScore(query, [VIEW_LABELS[v], "view"]) > 0);
        const nodes = index.entries
          .map((e) => { const info = views.of(e.kind); const name = titleOf(e, info); return { e, info, name, score: paletteScore(query, [e.id, name, info.label]) }; })
          .filter((n) => n.score > 0)
          .sort((a, b) => b.score - a.score || a.e.id.length - b.e.id.length)
          .slice(0, PALETTE_NODE_LIMIT);
        const describe = anchor ? `Describe a change (anchored to ${titleOf(anchor, views.of(anchor.kind))})` : "Describe a change";
        const actions: { id: string; label: string; keywords: string[]; run(): void }[] = [
          { id: "describe", label: describe, keywords: ["describe", "change", "intent", "propose", "work"], run: () => go(href("work", { panel: "intent", anchor: anchor?.id ?? null })) },
          { id: "admin", label: "Admin token…", keywords: ["admin", "token", "auth"], run: () => closeThen(() => window.dispatchEvent(new Event(OPEN_ADMIN_TOKEN_EVENT))) },
          ...(fixture ? [{ id: "retry", label: "Retry API", keywords: ["retry", "api", "fixture", "reconnect"], run: () => { close(); retry(); } }] : []),
          { id: "effects", label: effects.enabled ? "Effects: turn off" : "Effects: turn on", keywords: ["effects", "ambient", "animation", "motion", "glow"], run: () => { close(); effects.toggle(); } },
        ].filter((a) => paletteScore(query, [a.label, ...a.keywords]) > 0);
        return <>
          {viewRows.length > 0 && <PaletteGroup heading="Views">
            {viewRows.map((v) => {
              const key = Object.entries(GO_KEYS).find(([, name]) => name === v)?.[0];
              return <PaletteItem key={v} value={`view.${v}`} onSelect={() => go(href(v as ViewName))} name={VIEW_LABELS[v]}
                trail={<>{v === "review" && <Count n={reviewCount} tone="attention" srLabel="waiting" />}{key && <Kbd keys={["g", key]} sequence />}</>} />;
            })}
          </PaletteGroup>}
          {nodes.length > 0 && <PaletteGroup heading="Nodes">
            {nodes.map(({ e, info, name }) => (
              <PaletteItem key={e.id} value={`node.${e.id}`} glyph={info.glyph} glyphStyle={kindColour(info)} name={name} id={e.id}
                onSelect={() => {
                  close();
                  if (bestViewFor(e.type) === "map" || (view === "map" && ["system", "external"].includes(e.type))) atlas.locate(e.id);
                  else setFocus(e.id, { view: bestViewFor(e.type) });
                }} />
            ))}
          </PaletteGroup>}
          {actions.length > 0 && <PaletteGroup heading="Actions">
            {actions.map((a) => <PaletteItem key={a.id} value={`action.${a.id}`} name={a.label} onSelect={a.run} />)}
          </PaletteGroup>}
        </>;
      }}
    </PaletteFrame>
  );
}
