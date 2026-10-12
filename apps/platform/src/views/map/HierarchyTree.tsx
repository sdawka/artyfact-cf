import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { kindInfo } from "@/model/kinds";
import type { ModelIndex } from "@/model/index";
import { useModel } from "@/model/useModel";
import styles from "./HierarchyTree.module.css";

export const ROW_HEIGHT = 28;
const OVERSCAN = 8;
const FALLBACK_VIEWPORT = 480;

interface Row {
  id: string;
  name: string;
  kind: string;
  level: number;
  hasChildren: boolean;
  parent: string | undefined;
  setSize: number;
  posInSet: number;
}

function flatten(index: ModelIndex, root: string, expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const visit = (id: string, level: number, parent: string | undefined, setSize: number, posInSet: number) => {
    const e = index.byId(id);
    if (!e) return;
    const kids = index.children(id);
    rows.push({ id, name: e.name, kind: e.kind, level, hasChildren: kids.length > 0, parent, setSize, posInSet });
    if (expanded.has(id)) kids.forEach((k, i) => visit(k.id, level + 1, id, kids.length, i + 1));
  };
  visit(root, 1, undefined, 1, 1);
  return rows;
}

const domId = (id: string) => `map-tree-${id.replace(/[^\w-]/g, "_")}`;

export interface HierarchyTreeProps {
  /** Current Map scope (marked in the tree). */
  scope: string;
  /** Focused id (aria-selected). */
  focusId: string | null;
  /** Enter or click on a row. */
  onSelect: (id: string) => void;
}

/**
 * Containment tree (System → things → nodes), windowed: only rows in view (+ overscan) are in the DOM.
 * One tab stop with `aria-activedescendant`; ↑↓ move, → expands / enters, ← collapses / goes to
 * the parent, Home/End, Enter selects.
 */
export function HierarchyTree({ scope, focusId, onSelect }: HierarchyTreeProps) {
  const { index, path } = useModel();
  const root = index.model.system.id;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root, ...path(focusId ?? scope).slice(0, -1).map((e) => e.id), scope]));
  const rows = useMemo(() => flatten(index, root, expanded), [index, root, expanded]);
  const [activeId, setActiveId] = useState<string>(focusId ?? scope);
  const viewport = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(FALLBACK_VIEWPORT);

  // Reveal the scope / focus when they change elsewhere (Map double-click, palette, breadcrumbs).
  useEffect(() => {
    const target = focusId ?? scope;
    const ancestors = [...path(scope), ...path(target).slice(0, -1)].map((e) => e.id);
    setExpanded((prev) => (ancestors.every((a) => prev.has(a)) ? prev : new Set([...prev, ...ancestors])));
    if (index.byId(target)) setActiveId(target);
  }, [scope, focusId, path, index]);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight || FALLBACK_VIEWPORT));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeIndex = Math.max(0, rows.findIndex((r) => r.id === activeId));
  const active = rows[activeIndex];

  // Keep the active row inside the viewport (it must be rendered for aria-activedescendant).
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const top = activeIndex * ROW_HEIGHT;
    const view = el.clientHeight || height;
    let next = el.scrollTop;
    if (top < next) next = top;
    else if (top + ROW_HEIGHT > next + view) next = top + ROW_HEIGHT - view;
    if (next !== el.scrollTop) {
      el.scrollTop = next;
      setScrollTop(next);
    }
  }, [activeIndex, height]);

  const toggle = (id: string, open: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    const move = (i: number) => setActiveId(rows[Math.min(rows.length - 1, Math.max(0, i))]!.id);
    switch (e.key) {
      case "ArrowDown":
        move(activeIndex + 1);
        break;
      case "ArrowUp":
        move(activeIndex - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case "ArrowRight":
        if (!active.hasChildren) return;
        if (!expanded.has(active.id)) toggle(active.id, true);
        else move(activeIndex + 1);
        break;
      case "ArrowLeft":
        if (active.hasChildren && expanded.has(active.id)) toggle(active.id, false);
        else if (active.parent) setActiveId(active.parent);
        else return;
        break;
      case "Enter":
        onSelect(active.id);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN);

  return (
    <div
      ref={viewport}
      className={styles.tree}
      role="tree"
      aria-label="Containment"
      tabIndex={0}
      {...(active && { "aria-activedescendant": domId(active.id) })}
      onKeyDown={onKeyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className={styles.spacer} style={{ height: rows.length * ROW_HEIGHT }}>
        {rows.slice(start, end).map((r, i) => {
          const info = kindInfo(r.kind);
          const open = expanded.has(r.id);
          return (
            <div
              key={r.id}
              id={domId(r.id)}
              role="treeitem"
              aria-level={r.level}
              aria-setsize={r.setSize}
              aria-posinset={r.posInSet}
              aria-selected={r.id === focusId}
              {...(r.hasChildren && { "aria-expanded": open })}
              data-active={r.id === active?.id || undefined}
              data-scope={r.id === scope || undefined}
              className={styles.row}
              style={{ top: (start + i) * ROW_HEIGHT, height: ROW_HEIGHT, paddingLeft: `calc(${r.level - 1} * var(--spacing-4) + var(--spacing-1))` }}
              onClick={() => {
                setActiveId(r.id);
                onSelect(r.id);
              }}
            >
              <span
                className={styles.twisty}
                aria-hidden="true"
                onClick={(e) => {
                  if (!r.hasChildren) return;
                  e.stopPropagation();
                  setActiveId(r.id);
                  toggle(r.id, !open);
                }}
              >
                {r.hasChildren ? (open ? "▾" : "▸") : ""}
              </span>
              <span className={styles.glyph} aria-hidden="true">{info.glyph}</span>
              <span className={styles.name}>{r.name}</span>
              <span className="sr-only">, {info.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
