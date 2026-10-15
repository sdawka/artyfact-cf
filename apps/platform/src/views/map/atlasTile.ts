import type { KindViews } from "@/model/kinds";
import type { MapNode } from "./useMapGraph";

/**
 * One source for a tile's content and its height. The layout sizes every tile from these numbers before render, and the
 * tile CSS uses the same pixel line heights (`--tile-*` in nodes.module.css), so text never overflows its box and the box
 * never holds more than a line of slack. Widths are estimated conservatively (wide average glyphs), so a tile may end a
 * few pixels early but text is never cut mid-line.
 */
export const TILE = {
  width: 288,
  systemWidth: 588,
  gap: 12,
  padX: 16,
  tab: 28,
  titleLine: 22,
  systemTitleLine: 30,
  metaLine: 18,
  purposeLine: 20,
  summaryLine: 20,
  button: 44,
  /** The footer's text-style Open button: its word plus side padding, measured at the summary size with room to spare. */
  open: 64,
  lane: 18,
  padBottom: 10,
} as const;

/** The text styles a tile sets, as the layout measures them. */
export type TileFont = "title" | "systemTitle" | "purpose" | "summary";
/** Width in px of `text` set in `font`. */
export type Measure = (text: string, font: TileFont) => number;

/** Average advance per character, rounded up, for the faces and sizes the tile uses: the fallback without a canvas. */
const ADVANCE: Record<TileFont, number> = { title: 9.2, systemTitle: 12.6, purpose: 7.9, summary: 7.6 };
export const estimate: Measure = (text, font) => text.length * ADVANCE[font];
const MAX = { title: 4, purpose: 3, summary: 2 };

/** Greedy word wrap: the lines a browser needs to set `text` in `width`. `measure` defaults to one unit per character. */
export function wrapLines(text: string, width: number, measure: (text: string) => number = (t) => t.length): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let lines = 1, line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= width) { line = next; continue; }
    if (line) lines++;
    // A word longer than a line breaks across lines (overflow-wrap: anywhere in the tile CSS).
    const extra = Math.max(0, Math.ceil(measure(word) / width) - 1);
    lines += extra;
    line = extra ? "" : word;
  }
  return lines;
}

/**
 * The purpose as the tile shows it: whole when it fits in three lines, else cut after the last sentence that fits, else
 * the full text faded on its last line. Never an ellipsis inside a word; the full text stays in the Inspector.
 */
export function clampPurpose(text: string, width: number, measure: (text: string) => number = (t) => t.length): { text: string; lines: number; faded: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  const lines = wrapLines(clean, width, measure);
  if (lines <= MAX.purpose) return { text: clean, lines, faded: false };
  let cut = -1;
  for (const m of clean.matchAll(/[.;:!?](?=\s|$)/g)) {
    const candidate = clean.slice(0, m.index + 1);
    if (wrapLines(candidate, width, measure) > MAX.purpose) break;
    cut = m.index + 1;
  }
  // A cut keeps at least a full line of text; a shorter first sentence would read as a fragment.
  if (cut > 0 && measure(clean.slice(0, cut)) >= width) {
    const sentence = clean.slice(0, cut).replace(/[;:]$/, ".");
    return { text: sentence, lines: wrapLines(sentence, width, measure), faded: false };
  }
  return { text: clean, lines: MAX.purpose, faded: true };
}

const plain = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A purpose that only repeats the name (a commitment's statement is both) is not shown twice. */
export function restates(name: string, description: string): boolean {
  const a = plain(name), b = plain(description);
  if (!a || !b) return false;
  const head = Math.min(a.length, b.length, 60);
  return a.slice(0, head) === b.slice(0, head);
}

export interface InsideItem { kind: string; text: string }

const lowerFirst = (word: string) => (word.length > 1 && word[1] === word[1]!.toLowerCase() ? word[0]!.toLowerCase() + word.slice(1) : word);

/** "3 endpoints", "1 module": at most three kinds, then "n more". */
export function insideSummary(node: Pick<MapNode, "inside">, views: KindViews): { items: InsideItem[]; more: number } {
  const items = node.inside.slice(0, 3).map(({ kind, count }) => {
    const view = views.of(kind);
    return { kind, text: `${count} ${lowerFirst(count === 1 ? view.label : view.plural)}` };
  });
  const more = node.inside.slice(3).reduce((sum, { count }) => sum + count, 0);
  return { items, more };
}

export interface TileMetrics {
  titleLines: number;
  /** The name runs past its line budget: its last line fades instead of ending in an ellipsis. */
  titleFaded: boolean;
  purpose: { text: string; lines: number; faded: boolean };
  summaryLines: number;
  height: number;
}

/** What the tile shows and how tall it is at `width`. Runtime state never enters this calculation. */
export function tileMetrics(node: MapNode, views: KindViews, width: number = TILE.width, measure: Measure = estimate): TileMetrics {
  const system = node.kind === "system";
  // Two pixels of slack absorb sub-pixel differences between the canvas and the laid-out text.
  const inner = width - 2 * TILE.padX - 2;
  const titleFont: TileFont = system ? "systemTitle" : "title";
  const nameLines = Math.max(1, wrapLines(node.name, inner, (t) => measure(t, titleFont)));
  const titleLines = Math.min(MAX.title, nameLines);
  const purpose = node.description && !restates(node.name, node.description) ? clampPurpose(node.description, inner, (t) => measure(t, "purpose")) : { text: "", lines: 0, faded: false };
  let summaryLines = 0;
  if (node.childCount > 0) {
    const { items, more } = insideSummary(node, views);
    // Items never break inside (white-space: nowrap); each is a glyph cell, 4px and its words, 12px apart, beside Open.
    const widths = [...items.map((i) => measure("##", "summary") + 4 + measure(i.text, "summary")), ...(more ? [measure(`${more} more`, "summary")] : [])];
    let lines = 1, used = 0;
    for (const w of widths) {
      if (used && used + 12 + w > inner - TILE.open - 8) { lines++; used = w; } else used += (used ? 12 : 0) + w;
    }
    summaryLines = Math.min(MAX.summary, lines);
  }
  let height = TILE.tab + 10 + titleLines * (system ? TILE.systemTitleLine : TILE.titleLine);
  if (node.role === "outside") height += 4 + TILE.metaLine;
  if (purpose.lines) height += 6 + purpose.lines * TILE.purposeLine;
  // The footer row: counts by kind beside the Open button, as tall as the button's 44px hit area (two count lines fit).
  if (node.childCount > 0) height += 8 + 1 + Math.max(TILE.button, summaryLines * TILE.summaryLine);
  // Every in-System tile keeps one lane for layer badges, so switching Genome, Proteome and Phenome never moves a tile.
  if (node.role !== "external") height += 4 + TILE.lane;
  height += TILE.padBottom;
  return { titleLines, titleFaded: nameLines > MAX.title, purpose, summaryLines, height: Math.ceil(height) };
}
