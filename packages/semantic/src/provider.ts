import { providerFromEnv, type ProviderEnv, type SystemOne } from '@artyfact/ontology';

export { cacheKeyFor, fakeAnswer, fakeAnswers, S1Error, wireQuestions, type S1ErrorCode } from '@artyfact/ontology';

/** `FAKE_S1`, `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY` (`OPENROUTER_MODEL`) and an injectable `fetch`. */
export type SystemOneEnv = ProviderEnv;

/** The engine's provider choice: `FAKE_S1=1` > TypeSafe > OpenRouter > off. */
export const createSystemOne = (env: SystemOneEnv): SystemOne => providerFromEnv(env);
