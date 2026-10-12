// Request/response shapes for POST /v1/systemone. Names mirror @typesafe-ai/sdk; we use raw fetch.

export type NoulCriteria = { true: string; false: string };
export type ChoiceCriteria = Record<string, string>; // option -> description (<=255 chars)
export type ScoreCriteria = string[]; // 2-10 level descriptions

export type Instructions = string | object | unknown[];

export type NoulQuestion = { type: 'noul'; instructions: Instructions; criteria: NoulCriteria };
export type ChoiceQuestion = { type: 'choice'; instructions: Instructions; criteria: ChoiceCriteria };
export type ScoreQuestion = { type: 'score'; instructions: Instructions; criteria: ScoreCriteria };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export type NoulAnswer = { type: 'noul'; noul: number };
export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer = {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence: number;
  legend?: unknown;
};
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type SystemOneRequest = { state: unknown; model: string; questions: Questions };
export type SystemOneResponse = {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens: number; output_tokens: number };
};

export type S1Mode = 'typesafe' | 'openrouter' | 'fake' | 'off';
export type Usage = { input_tokens: number; output_tokens: number };

export interface S1Reply {
  answers: Record<string, Answer>;
  model: string;
  ms: number;
  usage: Usage;
  provider: 'typesafe' | 'openrouter' | 'fake';
}

export interface AskOptions {
  timeoutMs?: number;
  retries?: number;
  /** Override the default cache key (see `cacheKeyFor`). */
  cacheKey?: string;
  /** Delay before a retry. Default 200 ms. */
  backoffMs?: number;
}

export interface SystemOne {
  mode: S1Mode;
  model: string;
  ask(state: unknown, questions: Questions, opts?: AskOptions): Promise<S1Reply>;
}

export type Provenance = {
  provider: 'typesafe' | 'openrouter' | 'fake' | 'off' | 'error';
  model: string;
  questionHash: string;
  stateHash: string;
  ms: number;
  usage: Usage;
  /** Set when provider is 'error' or 'off': why the call failed. */
  error?: { name: string; message: string; code?: string; status?: number };
};

export type Verdict = 'pass' | 'fail' | 'unknown';
export type Level = 'error' | 'warning' | 'info';
