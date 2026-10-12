// Pure question builders, one per Appendix E section. Ids are code-only (never sent as meaning),
// so every instruction states what is being asked in full. State is built alongside so the pair
// stays in sync; pass both to `SystemOne.ask`.
import type { Commitment, EvolutionSummary, Governing, OntologyNode, SemanticChange, SemanticModel, TheoryClaim } from './model-types';
import { PRIVATE_PAIRS_PROFILE } from './model-types';
import type { Questions } from './types';

const cap = (s: string, n = 255) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── E.1 ──────────────────────────────────────────────────────────────────────────────────────────
export const CHANGE_CLASSES = [
  'deliberate-nonstandard-choice',
  'unresolved-interpretation',
  'hard-rule-violation',
  'clarification',
] as const;

export function reviewDeltaState(m: SemanticModel, change: SemanticChange, commitments: Commitment[], governing: Governing) {
  return {
    system: { id: m.system.id, purpose: m.system.purpose },
    commitments: commitments.map((c) => ({ id: c.id, statement: c.statement })),
    change: { id: change.id, kind: change.kind, before: change.before, after: change.after, fieldsChanged: change.fieldsChanged },
    governing: { criteria: governing.criteria, requirements: governing.requirements },
  };
}

export function reviewDeltaQuestions(change: SemanticChange, commitments: Commitment[], _governing?: Governing): Questions {
  const q: Questions = {
    changeClass: {
      type: 'choice',
      benign: 'deliberate-nonstandard-choice',
      instructions:
        'Classify this Genome change (state.change) relative to the System\'s accepted contract (state.commitments and state.governing, in light of state.system.purpose).',
      criteria: {
        'deliberate-nonstandard-choice': 'an unusual but coherent product decision that contradicts no accepted hard rule',
        'unresolved-interpretation': 'ambiguous or underspecified; could be read two ways',
        'hard-rule-violation': 'contradicts an accepted criterion, requirement or commitment listed in state.governing or state.commitments',
        clarification: 'wording or structure only; meaning unchanged',
      },
    },
    weakens: {
      type: 'noul',
      benign: 'no',
      instructions:
        'Compared with state.change.before, does state.change.after weaken, remove or make untestable an obligation in state.governing?',
      criteria: {
        true: 'The change weakens, removes or makes untestable at least one obligation in state.governing.',
        false: 'No obligation in state.governing is weakened, removed or made untestable.',
      },
    },
    specificity: {
      type: 'score',
      benign: 3,
      instructions: 'How specific and testable is state.change.after as a requirement?',
      criteria: [
        'aspirational, no observable condition',
        'observable but no scope, role or state',
        'observable with scope, missing failure behaviour or limits',
        'fully testable: scope, condition, failure behaviour, limits',
      ],
    },
    touchesConsent: {
      type: 'noul',
      benign: 'no',
      instructions:
        'Does this change (state.change) alter who may see or act on another person\'s data, or the consent needed to do so?',
      criteria: {
        true: 'The change alters who may see or act on another person\'s data, or the consent required.',
        false: 'The change does not affect visibility, action rights over another person\'s data, or consent.',
      },
    },
  };
  for (const c of commitments) {
    q[`contradicts.${c.id}`] = {
      type: 'noul',
      benign: 'no',
      instructions: `Does state.change.after contradict commitment ${c.id}: "${c.statement}"?`,
      criteria: {
        true: `The changed content contradicts commitment ${c.id}: "${cap(c.statement, 200)}"`,
        false: `The changed content is compatible with, or silent on, commitment ${c.id}.`,
      },
    };
  }
  return q;
}

// ── E.2 ──────────────────────────────────────────────────────────────────────────────────────────
export function topologyState(node: OntologyNode, profile: string = PRIVATE_PAIRS_PROFILE) {
  return { node: { id: node.id, kind: node.kind, name: node.name, effects: node.effects, fields: node.fields }, profile };
}

export function topologyQuestions(_node?: OntologyNode, _profile?: string): Questions {
  return {
    multiRecipient: {
      type: 'noul',
      benign: 'no',
      instructions: 'Does the operation or affordance described by state.node send or address one action to more than one person at once?',
      criteria: {
        true: 'One action is sent to, or addressed to, more than one person at once (recipient lists, bulk send, group threads).',
        false: 'Each action is addressed to exactly one person.',
      },
    },
    isPublication: {
      type: 'noul',
      benign: 'yes',
      instructions:
        'Is state.node a reader-driven publication (an author publishes and approved readers independently read) rather than a direct send?',
      criteria: {
        true: 'An author publishes once and approved readers independently choose to read it; nothing is pushed to a recipient list.',
        false: 'It is a direct send: the author addresses the action to specific recipients.',
      },
    },
  };
}

// ── E.3 ──────────────────────────────────────────────────────────────────────────────────────────
export function purposeMeasureState(purpose: string, claim: TheoryClaim) {
  return {
    purpose,
    claim: {
      id: claim.id,
      mechanism: claim.mechanism,
      outcome: claim.outcome,
      indicator: claim.indicator,
      evaluationMethod: claim.evaluationMethod,
      limitation: claim.limitation,
    },
  };
}

export function purposeMeasureQuestions(_purpose?: string, _claim?: TheoryClaim): Questions {
  return {
    engagementSubstitute: {
      type: 'noul',
      benign: 'no',
      instructions:
        'Does state.claim.indicator measure app engagement (time spent, volume, opens) as if it were the wanted outcome in state.claim.outcome?',
      criteria: {
        true: 'The indicator is an engagement metric standing in for the wanted outcome.',
        false: 'The indicator is not merely engagement standing in for the outcome.',
      },
    },
    outcomeNotOutput: {
      type: 'noul',
      benign: 'yes',
      instructions: 'Does state.claim.outcome describe a change for the beneficiary rather than a delivered feature?',
      criteria: {
        true: 'The outcome is a change in the beneficiary\'s situation or behaviour.',
        false: 'The outcome merely describes something the product delivers or ships.',
      },
    },
    measurable: {
      type: 'score',
      benign: 2,
      instructions: 'How measurable is state.claim, given its indicator and evaluationMethod?',
      criteria: [
        'no way to observe',
        'observable with a stated method',
        'observable with method, population and time window',
      ],
    },
  };
}

// ── E.4 ──────────────────────────────────────────────────────────────────────────────────────────
export function interferenceState(a: EvolutionSummary, b: EvolutionSummary, shared: unknown, journeys: string[] = [], criteria: unknown[] = []) {
  return { a, b, shared, journeys, criteria };
}

export function interferenceQuestions(_a?: EvolutionSummary, _b?: EvolutionSummary, _shared?: unknown): Questions {
  return {
    interferes: {
      type: 'noul',
      benign: 'no',
      instructions:
        'Would applying both changes (state.a and state.b) together alter a shared user journey or an outcome hypothesis in a way neither change alone intends?',
      criteria: {
        true: 'Together the changes alter a shared journey or outcome hypothesis in a way neither intends alone.',
        false: 'The changes do not interact in any unintended way.',
      },
    },
    needsComposition: {
      type: 'noul',
      benign: 'no',
      instructions: 'Must the two changes (state.a and state.b) be tested together as one composition rather than independently?',
      criteria: {
        true: 'They must be tested together as one composition.',
        false: 'They can be tested independently.',
      },
    },
  };
}

// ── E.5 ──────────────────────────────────────────────────────────────────────────────────────────
export type KindOption = { kind: string; description?: string };
export type AttachCandidate = { id: string; name?: string; description?: string };

export function classifyStatementState(sentence: string, candidates: AttachCandidate[]) {
  return { sentence, candidates: candidates.map((c) => ({ id: c.id, name: c.name, description: c.description })) };
}

export function classifyStatementQuestions(_sentence: string, kinds: KindOption[], candidates: AttachCandidate[]): Questions {
  const kindCriteria: Record<string, string> = {};
  for (const k of kinds) kindCriteria[k.kind] = cap(k.description ?? `a statement that describes a ${k.kind}`);
  kindCriteria.commitment ??= 'a deliberate promise or rule the System must keep';
  kindCriteria.hypothesis ??= 'a belief about cause and effect that is yet to be tested';
  kindCriteria.none ??= 'none of the above; not a design statement';
  const attach: Record<string, string> = {};
  for (const c of candidates) attach[c.id] = cap(`the existing node "${c.name ?? c.id}"${c.description ? `: ${c.description}` : ''}`);
  attach.new ??= 'no listed node fits; this introduces a new node';
  return {
    kind: {
      type: 'choice',
      benign: Object.keys(kindCriteria)[0],
      instructions: 'What kind of Genome element does state.sentence express?',
      criteria: kindCriteria,
    },
    attachTo: {
      type: 'choice',
      benign: Object.keys(attach)[0],
      instructions: 'Which existing node in state.candidates does state.sentence most directly describe or constrain? Choose "new" if none fits.',
      criteria: attach,
    },
    isDistinctiveChoice: {
      type: 'noul',
      benign: 'yes',
      instructions: 'Is state.sentence a deliberate, non-generic design commitment worth preserving verbatim?',
      criteria: {
        true: 'It is a deliberate, specific design commitment worth keeping word for word.',
        false: 'It is generic or incidental wording that can be paraphrased.',
      },
    },
  };
}

