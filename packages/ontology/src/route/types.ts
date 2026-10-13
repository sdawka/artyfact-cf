import type { GraphLink } from "../graph/graph.ts";
import type { SliceNode } from "../judge/slice.ts";
import type { AskOptions, JudgmentStatus, Thresholds, Usage } from "../judge/types.ts";

/** What the user wants done. `question`: too vague to act on, ask back. `answer`: the user asks for information. */
export const ROUTE_INTENTS = ["add", "update", "remove", "link", "question", "answer"] as const;
export type RouteIntent = (typeof ROUTE_INTENTS)[number] | "unclear";
/** Declared escape options; `none` at the node level of an `add` means "no anchor". */
export const ROUTE_NONE = "none";
export const ROUTE_NEW = "new";
export const ROUTE_UNCLEAR = "unclear";

export type RouteLevel = "shortlist" | "intent" | "space" | "kind" | "node" | "more" | "nodes" | "anchor";
export type RouteOrder = "shortlist-first" | "intent-first" | "intent-last";

export interface RouteStep {
  level: RouteLevel;
  /** Question id, e.g. `route.kind`. */
  id: string;
  /** The question text sent to System One. */
  question: string;
  /** Option keys in the order offered. */
  choices: string[];
  answer?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  status: JudgmentStatus;
  error?: string;
}

export interface RouteTarget {
  space?: string;
  kind?: string;
  /** Picked nodes; for `add` these are anchors the new node links to (or, intent-last, a same-kind sibling). */
  nodes: string[];
  /** The node level answered `new`: the message concerns something not in the graph yet. */
  new?: boolean;
  /** Context for the translator when no node was picked: the nodes nearest the message in the resolved scope. */
  related: string[];
}

export interface RouteProvenance {
  provider: string;
  model: string;
  usage: Usage;
  thresholds: Thresholds;
  errors?: string[];
  /** The call budget cut the chain short. */
  truncated?: boolean;
}

export interface Route {
  message: string;
  order: RouteOrder;
  /** The root the spaces hang off; a top-level addition may name it as its space. */
  root: string;
  intent?: RouteIntent;
  path: RouteStep[];
  target: RouteTarget;
  /** `confident` when every deciding step was confident and the chain reached its end. */
  status: JudgmentStatus;
  calls: number;
  provenance: RouteProvenance;
}

export interface RouteOptions {
  /**
   * Space -> kinds. Given, the space level offers these spaces (product graphs, e.g. `PRODUCT_SPACES`); absent,
   * the spaces are the root's direct children (sections) plus the root itself for top-level additions.
   */
  spaces?: Record<string, string[]>;
  spaceLabels?: Record<string, string>;
  kindLabels?: Record<string, string>;
  /** Root node; default the parentless non-`ws.` node with the most descendants. */
  root?: string;
  /** Node options per question before `none`/`new`. Default 12. */
  maxChoices?: number;
  /** Nodes one route may pick. Default 3. */
  maxNodes?: number;
  /** System One calls per message. Default 8. */
  maxCalls?: number;
  /** Example titles per space or kind option. Default 3. */
  examples?: number;
  thresholds?: Partial<Thresholds>;
  /** Keep walking after a `review` step, using its answer; the route's status stays `review`. Default true. */
  continueOnReview?: boolean;
  /**
   * `shortlist-first` (default): one question over the nodes nearest the message, the intent-last chain as fallback.
   * `intent-last`: space, kind, node, then the intent with the picked nodes in view. `intent-first`: the intent first.
   */
  order?: RouteOrder;
  ask?: AskOptions;
}

/** A graph edit in canonical terms. An `add` link names the other end with `to` (new -> it) or `from` (it -> new). */
export type Op =
  | { op: "add"; kind: string; parent?: string; title: string; description?: string; links?: { rel: string; to?: string; from?: string }[] }
  | { op: "update"; id: string; fields: Record<string, unknown> }
  | { op: "remove"; id: string }
  | { op: "link" | "unlink"; from: string; rel: string; to: string };

export interface RouteSlice { targets: string[]; nodes: SliceNode[]; links: GraphLink[] }

/** Legal kinds and relations near the route, so the translator need not see the whole template. */
export interface RouteVocabulary { kinds: string[]; relations: Record<string, { from: string[]; to: string[] }> }

export interface TranslateInput { message: string; route: Route; slice: RouteSlice; vocabulary?: RouteVocabulary }

export interface Translation {
  ops?: Op[];
  question?: string;
  answer?: string;
  model: string;
  provider: string;
  usage?: Usage;
  error?: string;
  /** The model's raw reply, kept for evaluation. */
  raw?: string;
}

export interface Translator {
  mode: "http" | "fake" | "off";
  model: string;
  translate(input: TranslateInput, opts?: AskOptions): Promise<Translation>;
}

export interface OpProblem {
  level: "error" | "warning";
  rule: string;
  /** Index of the op in the list. */
  op: number;
  subjects: string[];
  message: string;
}
