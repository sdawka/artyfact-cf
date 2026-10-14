import { providerFromEnv, visionProviderFromEnv, type ProviderEnv, type SystemOne } from '@artyfact/ontology';

export {
  cacheKeyFor, checkImages, fakeAnswer, fakeAnswers, IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_TOTAL_IMAGE_BYTES, S1Error, wireQuestions, type S1ErrorCode,
} from '@artyfact/ontology';

/** `FAKE_S1`, `TYPESAFE_API_KEY`, the Workers AI binding `AI` (`CLEF_MODEL`), `OPENROUTER_API_KEY` (`OPENROUTER_MODEL`) and an injectable `fetch`. */
export type SystemOneEnv = ProviderEnv;

/** The engine's provider choice: `FAKE_S1=1` > TypeSafe > Clef (`AI` bound) > OpenRouter > off. */
export const createSystemOne = (env: SystemOneEnv): SystemOne => providerFromEnv(env);

/** The provider for screenshot judgments: `selected` when it reads images, else Clef when `AI` is bound, else `selected`. */
export const createVisionSystemOne = (env: SystemOneEnv, selected?: SystemOne): SystemOne => visionProviderFromEnv(env, selected);
