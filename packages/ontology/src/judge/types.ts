import type { Explanation } from "./explain.ts";

export type NoulCriteria = { true: string; false: string };
export type ChoiceCriteria = Record<string, string>;
export type ScoreCriteria = string[];
export type Instructions = string | object | unknown[];

/** `benign` is read by the fake provider only and stripped before a question goes on the wire. */
export type NoulQuestion = { type: "noul"; instructions: Instructions; criteria: NoulCriteria; benign?: "yes" | "no" };
export type ChoiceQuestion = { type: "choice"; instructions: Instructions; criteria: ChoiceCriteria; benign?: string };
/** `benign` is a level index into `criteria`. */
export type ScoreQuestion = { type: "score"; instructions: Instructions; criteria: ScoreCriteria; benign?: number };
export type S1Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type S1Questions = Record<string, S1Question>;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer = { type: "score"; score: number; probabilities: Record<string, number>; confidence: number; legend?: unknown };
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type Usage = { input_tokens: number; output_tokens: number };
export type S1Mode = "http" | "fake" | "off";

export interface S1Reply {
  answers: Record<string, Answer>;
  model: string;
  ms: number;
  usage: Usage;
  provider: string;
}

export type S1ImageType = "image/png" | "image/jpeg" | "image/webp";
/** An embedded image for a provider that reads images (Clef). `sha256` (hex of the bytes) is provenance only; cache keys hash the base64 itself. */
export interface S1Image { mediaType: S1ImageType; base64: string; sha256?: string }

export interface AskOptions {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  /** An extra scope mixed into the cache key; it never replaces the state, questions, model or image hashes. */
  cacheKey?: string;
  /** At most 4, each at most 4 MiB and 8 MiB together (`checkImages`). Only a provider with `images: true` sends them. */
  images?: S1Image[];
}

export interface SystemOne {
  mode: S1Mode;
  model: string;
  /** True when `ask` sends `opts.images` to the model; any other provider refuses them with an `unsupported` S1Error. */
  images?: boolean;
  ask(state: unknown, questions: S1Questions, opts?: AskOptions): Promise<S1Reply>;
}

export interface Thresholds { confident: number; review: number }
export type JudgmentStatus = "confident" | "review" | "unknown";

export interface Provenance {
  /** The replying provider, `off` when nothing could be asked, `error` when the call failed. */
  provider: string;
  model: string;
  stateHash: string;
  questionHash: string;
  thresholds: Thresholds;
  usage?: Usage;
  /** Wall time of the provider call. */
  ms?: number;
  error?: { name: string; message: string; code?: string; status?: number };
  /** Funnel round (1 for stage-1 entry questions) and stage name of the ask that settled the finding. */
  round?: number;
  stage?: string;
  /** How many questions shared the provider call; `split` when a batch was re-asked one question at a time. */
  batch?: { size: number; split?: boolean };
  /** The explainer call behind `judgment.explanation`, without its text. */
  explained?: { provider: string; model: string; usage?: Usage; error?: string };
  /** A follow-up of this finding was cut by the call or round budget; the finding settled on an earlier step. */
  truncated?: boolean;
}

/** One answered question on the way from an entry question to the finding's defect. */
export interface JudgmentStep {
  question: string;
  subject: string;
  status: JudgmentStatus;
  answer?: string;
  confidence?: number;
  defect?: string;
  /** Score questions: probability mass on the chosen side of the pass boundary (see `scoreConfidence`). */
  bandedConfidence?: number;
}

export interface Judgment {
  question: string;
  status: JudgmentStatus;
  answer?: string;
  confidence?: number;
  /** The provider's distribution over answer keys (noul reads as `{yes, no}`). */
  probabilities?: Record<string, number>;
  /** defects@1 id the answer stands for. */
  defect?: string;
  /** Score questions: probability mass on the chosen side of the pass boundary, beside the top-level `confidence`. */
  bandedConfidence?: number;
  /** The checklist item (`kinds.<k>.checks[].id` or `rootChecks[].id`) when the entry question is a `check:` question. */
  check?: string;
  /** The questions asked to reach this judgment, entry question first. */
  path?: JudgmentStep[];
  /** Findings (rule ids or defect ids) that narrowed this one to a more specific defect. */
  narrowedBy?: string[];
  explanation?: Explanation;
}
