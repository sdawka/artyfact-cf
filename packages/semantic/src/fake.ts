import type { Answer, Questions } from './types';

// Directives anywhere in JSON(state):
//   #s1low        low-confidence answers (noul 0.55, confidence 0.3)
//   #s1no         noul 0.05; choice -> 'none' or the last option; score 0
//   #s1pick:<key> choice -> that key when the question offers it
//   #s1harm       every noul answers a confident "yes", harm questions included
// Otherwise confident "yes" / first option / top score, except noul questions whose "yes" means harm
// (HARM_IDS): those default to a confident "no", so a benign Genome reads as benign under FAKE_S1=1.
const HARM_IDS = /^(engagementSubstitute|weakens|contradicts\..+|multiRecipient|isPublication|interferes|needsComposition)$/;

export function fakeAnswer(q: Questions[string], flatState: string, id = ''): Answer {
  const low = flatState.includes('#s1low');
  const no = flatState.includes('#s1no');
  const wanted = /#s1pick:([\w-]+)/.exec(flatState)?.[1];
  const conf = low ? 0.3 : 0.95;
  if (q.type === 'noul') return { type: 'noul', noul: low ? 0.55 : no ? 0.05 : flatState.includes('#s1harm') || !HARM_IDS.test(id) ? 0.95 : 0.05 };
  if (q.type === 'choice') {
    const labels = Object.keys(q.criteria);
    const pick =
      wanted && labels.includes(wanted)
        ? wanted
        : no
          ? labels.includes('none')
            ? 'none'
            : (labels[labels.length - 1] ?? 'none')
          : (labels[0] ?? 'none');
    const probabilities = Object.fromEntries(
      labels.map((l) => [l, l === pick ? conf : (1 - conf) / Math.max(1, labels.length - 1)]),
    );
    return { type: 'choice', choice: pick, confidence: conf, probabilities };
  }
  const n = q.criteria.length;
  const score = no ? 0 : Math.max(0, n - 1);
  const probabilities = Object.fromEntries(
    Array.from({ length: n }, (_, i) => [String(i), i === score ? conf : (1 - conf) / Math.max(1, n - 1)]),
  );
  return { type: 'score', score, confidence: conf, probabilities };
}

export function fakeAnswers(state: unknown, questions: Questions): Record<string, Answer> {
  const flat = JSON.stringify(state ?? '');
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, fakeAnswer(q, flat, id)]));
}
