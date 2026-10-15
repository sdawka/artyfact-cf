import type { CSSProperties } from "react";
import { Button } from "@/components/ui";
import { kindColour, useKindViews, type KindView } from "@/model/kinds";
import { insideSummary, type TileMetrics } from "../atlasTile";
import type { MapNode } from "../useMapGraph";
import styles from "./nodes.module.css";

/** The tile's kind, flush in its top-left corner: the kind's glyph in its hue on a faint tint of it, then the kind word. */
export function KindTab({ view, label }: { view: KindView; label: string }) {
  return (
    <span className={styles.tab} style={kindColour(view)}>
      <span className={styles.tabGlyph} aria-hidden="true">{view.glyph}</span>
      <span>{label}</span>
    </span>
  );
}

/** Line budgets from the layout, so the CSS clamps exactly where the box ends. */
export const metricStyle = (m: TileMetrics) => ({ "--title-lines": m.titleLines, "--purpose-lines": m.purpose.lines, "--summary-lines": m.summaryLines }) as CSSProperties;

/** What Enter reveals, as counts by kind ("3 sections, 2 journeys"), then Open as a text button on the same row. */
export function InsideFooter({ node, onOpen }: { node: MapNode; onOpen: (id: string, viaKeyboard?: boolean) => void }) {
  const views = useKindViews();
  const { items, more } = insideSummary(node, views);
  return (
    <div className={styles.inside}>
      <ul className={styles.summary} aria-label="Inside">
        {items.map((item) => (
          <li key={item.kind} className={styles.count} style={kindColour(views.of(item.kind))}>
            <span className={styles.countGlyph} aria-hidden="true">{views.of(item.kind).glyph}</span>{item.text}
          </li>
        ))}
        {more > 0 && <li className={styles.count}>{more} more</li>}
      </ul>
      <Button
        variant="ghost"
        className={`nodrag nopan ${styles.openButton}`}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(node.id, e.detail === 0); // detail 0: activated from the keyboard
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={`Open ${node.name} (${node.childCount} inside)`}
      >
        Open
      </Button>
    </div>
  );
}
