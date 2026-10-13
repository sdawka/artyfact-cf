import type { Answer, S1Question, S1Questions } from "./types.ts";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A question id ends where an id character stops; ids may contain dots, colons and dashes. */
const END = "(?![\\w.:|-])";

// Directives anywhere in JSON(state):
//   #s1low            low-confidence answers (noul 0.55, confidence 0.3)
//   #s1no             noul 0.05; choice -> 'none' or the last option; score 0
//   #s1pick:<key>     choice -> that key when the question offers it
//   #s1harm           every noul answers a confident "yes"
//   #s1:<qid>=<key>   question <qid> only: a choice key, yes/no for a yes-no question, an integer level for a score;
//                     `<a>,<b>,…` answers a choice with the first key it offers (a router's repeated follow-ups)
//   #s1low:<qid>      question <qid> only: low confidence
// Per-question directives win over global ones. Otherwise each question gets its declared benign answer,
// confidently; without one, "yes" / the first option / the top level.
export function fakeAnswer(q: S1Question, flatState: string, id?: string): Answer {
  const owns = id === undefined ? undefined : new RegExp(`#s1:${escape(id)}=([\\w.:,-]+?)(?![\\w.:,|-])`).exec(flatState)?.[1]?.split(",");
  const ownLow = id !== undefined && new RegExp(`#s1low:${escape(id)}${END}`).test(flatState);
  const low = ownLow || /#s1low(?!:)/.test(flatState);
  const no = flatState.includes("#s1no");
  const wanted = /#s1pick:([\w-]+)/.exec(flatState)?.[1];
  const conf = low ? 0.3 : 0.95;
  const own = q.type === "choice" ? owns?.find((k) => k in q.criteria) ?? owns?.[0] : owns?.[0];
  if (q.type === "noul") {
    if (own === "yes" || own === "no") return { type: "noul", noul: own === "yes" ? (low ? 0.55 : 0.95) : (low ? 0.45 : 0.05) };
    return { type: "noul", noul: low ? 0.55 : no ? 0.05 : flatState.includes("#s1harm") || q.benign !== "no" ? 0.95 : 0.05 };
  }
  if (q.type === "choice") {
    const labels = Object.keys(q.criteria);
    const pick = own !== undefined && labels.includes(own) ? own
      : wanted && labels.includes(wanted) ? wanted
      : no ? (labels.includes("none") ? "none" : labels[labels.length - 1] ?? "none")
      : q.benign && labels.includes(q.benign) ? q.benign
      : labels[0] ?? "none";
    const probabilities = Object.fromEntries(labels.map((l) => [l, l === pick ? conf : (1 - conf) / Math.max(1, labels.length - 1)]));
    return { type: "choice", choice: pick, confidence: conf, probabilities };
  }
  const n = q.criteria.length;
  const level = own !== undefined && /^\d+$/.test(own) && Number(own) < n ? Number(own) : undefined;
  const score = level ?? (no ? 0 : q.benign !== undefined && q.benign >= 0 && q.benign < n ? q.benign : Math.max(0, n - 1));
  const probabilities = Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), i === score ? conf : (1 - conf) / Math.max(1, n - 1)]));
  return { type: "score", score, confidence: conf, probabilities };
}

export function fakeAnswers(state: unknown, questions: S1Questions): Record<string, Answer> {
  const flat = JSON.stringify(state ?? "");
  return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, fakeAnswer(q, flat, id)]));
}
