// One System One client: the engine's (`@artyfact/ontology`). These are its wire and reply types under the names the
// question builders use.
export type {
  Answer, AskOptions, ChoiceAnswer, ChoiceCriteria, ChoiceQuestion, Instructions, NoulAnswer, NoulCriteria, NoulQuestion, Provenance,
  S1Mode, S1Question as Question, S1Questions as Questions, S1Reply, ScoreAnswer, ScoreCriteria, ScoreQuestion, SystemOne, Usage,
} from '@artyfact/ontology';

export type Verdict = 'pass' | 'fail' | 'unknown';
export type Level = 'error' | 'warning' | 'info';
