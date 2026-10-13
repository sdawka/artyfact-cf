import type { DefectsConfig } from "../meta/schema.ts";

/**
 * defects@1: the ways a filled template can be wrong, as a tree the judgment funnel walks from a broad family to a
 * specific leaf. `label` is the choice key on the wire (the id's last segment); `criterion` is the sentence a decision
 * model sees for that option. Scope and level are inherited from the parent unless set; roots default to warning.
 */
export const DEFECTS_VERSION = "1";

/** What a defect is about: one node, a parent and its members, two nodes, or the whole specification. */
export type DefectScope = "node" | "set" | "pair" | "whole";
export type DefectLevel = "error" | "warning" | "info";

export interface Defect {
  id: string;
  parent?: string;
  scope: DefectScope;
  label: string;
  criterion: string;
  level: DefectLevel;
  /** The deterministic rule that already detects this defect; the funnel does not ask about it. */
  deterministic?: string;
}

/** The family whose level-3 leaves are generated per vocabulary, one per glossary kind. */
export const OTHER_KIND = "instance.otherKind";

type Spec = { criterion: string; scope?: DefectScope; level?: DefectLevel; deterministic?: string; children?: Record<string, Spec | string> };

const TREE: Record<string, Spec> = {
  instance: {
    scope: "node",
    criterion: "The item is not really an instance of the kind it is filed as: it is a placeholder, another kind, not a statement at all, several items in one, or pitched at the wrong level.",
    children: {
      placeholder: {
        deterministic: "text.placeholder",
        criterion: "The item is a placeholder rather than content: it is empty, a to-do marker, template boilerplate, or a copy of its parent.",
        children: {
          empty: "The item has no meaningful content: its text is blank, a single filler word, or only punctuation.",
          todo: "The item is a to-do marker such as TBD, TODO or 'fill in later' standing in for the real content.",
          boilerplate: "The item is template or example text left in place, generic wording that would fit any product unchanged.",
          copyOfParent: "The item repeats its parent's title or description instead of saying something of its own.",
        },
      },
      otherKind: {
        criterion: "The item is a well-formed statement, but of a different kind than the one it is filed as, for example a feature filed as an outcome.",
      },
      notAThing: {
        criterion: "The item is not a statement of the specification at all: it is a question, a comment, a note to the author, or only a pointer elsewhere.",
        children: {
          question: "The item asks a question or raises an open issue instead of stating something the product is or does.",
          comment: "The item is a remark, opinion or discussion note about the specification rather than part of it.",
          instructionToAuthor: "The item tells the author what to write or decide next instead of stating the content itself.",
          referenceOnly: "The item only points to another document, ticket or link and states nothing on its own.",
        },
      },
      compound: {
        criterion: "The item bundles several separate items into one, so parts of it could be accepted, built or tested independently.",
        children: {
          multipleBehaviours: "The item describes two or more distinct behaviours or requirements joined by 'and', 'also' or a list.",
          behaviourPlusRationale: "The item mixes what the product must do with why it should, so the reason is filed as part of the requirement.",
          list: "The item is a list of several items that should each be their own entry of this kind.",
          requirementPlusCriterion: "The item states a requirement and its acceptance criterion together instead of as separate linked items.",
        },
      },
      wrongLevel: {
        criterion: "The item is the right sort of content but pitched at the wrong level of the hierarchy, too concrete or too broad for its kind.",
        children: {
          outputAsOutcome: "The item names something the team will deliver (an output) where the kind expects a change in the world (an outcome).",
          taskAsOutcome: "The item names a piece of work to do where the kind expects a result that work should achieve.",
          criterionAsRequirement: "The item is a test or acceptance check where the kind expects the requirement it would verify.",
          sectionAsItem: "The item is a heading or grouping that should hold several items, filed as a single item.",
        },
      },
    },
  },
  specificity: {
    scope: "node",
    criterion: "The item is too unspecific to act on: two competent builders could read it and build materially different things, or not know when they are done.",
    children: {
      abstract: {
        criterion: "The item states an aim or quality in abstract terms and names no concrete behaviour, object or rule.",
        children: {
          intentOnly: "The item states only an intention or wish ('we want to help users') with no behaviour that would realise it.",
          qualityOnly: "The item names only a quality such as fast, secure or simple, with no behaviour or measure behind it.",
          jargon: "The item relies on buzzwords or undefined terms that a builder could not turn into specific behaviour.",
          sloganLike: "The item reads as a slogan or marketing line rather than a statement someone could build or check.",
        },
      },
      underspecified: {
        criterion: "The item names a behaviour but leaves out a part needed to build it: a threshold, the actor, the trigger, the object or the context.",
        children: {
          noThreshold: "The item implies a limit or amount but gives no number, bound or range.",
          noActor: "The item does not say who or what performs the behaviour, the user, the system or a third party.",
          noTrigger: "The item does not say when or on what event the behaviour happens.",
          noObject: "The item does not say what the behaviour acts on, which data, item or resource.",
          noContext: "The item does not say where, for whom or under what conditions the behaviour applies.",
        },
      },
      subjective: {
        criterion: "The item rests on a subjective judgement, so whether it holds depends on who is asked.",
        children: {
          qualityWord: "The item hinges on a subjective quality word such as intuitive, clean, seamless, nice or appropriate.",
          comparativeNoBaseline: "The item says better, faster, more or easier without saying compared to what.",
          userFeeling: "The item is stated as how users will feel (delighted, confident) rather than what they can do or what happens.",
          bestEffort: "The item is hedged as best effort, where possible or as appropriate, so any result could count as meeting it.",
        },
      },
      openEnded: {
        criterion: "The item has no boundary: it never says when it stops, what is excluded, or how much is enough.",
        children: {
          noStop: "The item describes ongoing or repeated behaviour with no stop condition, limit or end state.",
          etcetera: "The item ends a list with etc., and so on or similar, leaving the full set undefined.",
          anyAll: "The item claims any, all, every or always over an unbounded set, so its scope cannot be pinned down.",
          asNeeded: "The item says as needed, when necessary or if required without saying who decides or when.",
        },
      },
      ambiguous: {
        criterion: "The item can be read in two or more distinct ways, and the readings lead to different products.",
        children: {
          scope: "It is unclear which items, users or cases the statement covers, so its reach can be read narrowly or broadly.",
          referent: "A pronoun or term such as it, they or the item could refer to more than one thing.",
          negation: "Negation or exception wording makes it unclear what is allowed and what is forbidden.",
          order: "It is unclear in what order steps happen or which condition takes precedence over another.",
        },
      },
    },
  },
  testability: {
    scope: "node",
    criterion: "The item cannot be checked: no test, measurement or observation could show whether it holds.",
    children: {
      unmeasurable: {
        criterion: "The item names no observable quantity, event or condition, so nothing could be measured to see whether it holds.",
        children: {
          feeling: "The item is about a feeling or impression with no observable sign of it.",
          improvementNoMetric: "The item asks for an improvement without naming the metric that would show the improvement.",
          noUnit: "The item gives a number or amount with no unit or reference, so it cannot be measured against.",
          noEvent: "The item names no event or state change that could be observed when it happens.",
        },
      },
      unfalsifiable: {
        criterion: "No result could ever show the item is not met: it hedges, states opinion, is true by definition, or names no failure.",
        children: {
          hedged: "The item is hedged with should, may, ideally or where possible, so not meeting it is never a failure.",
          opinion: "The item states an opinion or value judgement that no observation can contradict.",
          tautology: "The item is true by definition or restates itself, so it cannot fail.",
          noFailCondition: "The item names what success looks like but no condition under which it would count as failed.",
        },
      },
      unobservable: {
        criterion: "Whether the item holds could not actually be observed with the means available: no source, no method, hidden state, or only in the future.",
        children: {
          noSource: "The item gives no data source or place where evidence of it would show up.",
          noMethod: "The item gives no method, test or procedure by which it would be checked.",
          privateState: "The item depends on someone's private intent, knowledge or state of mind that cannot be inspected.",
          futureOnly: "The item can only be judged long after delivery, with nothing observable at build or release time.",
        },
      },
      noTarget: {
        criterion: "The item measures something but gives no target to judge it against: no baseline, target value, direction or time horizon.",
        children: {
          noBaseline: "The item states a change without the starting value it changes from.",
          noTarget: "The item names a metric but no target value or threshold that counts as success.",
          noDirection: "The item names a metric but not whether it should go up, down or stay within a range.",
          noHorizon: "The item gives no date, period or deadline by which the target should be reached.",
        },
      },
      dependent: {
        criterion: "Whether the item holds depends on something outside the product's control, so a check would test that instead.",
        children: {
          thirdParty: "The item holds only if a third party, vendor or external service behaves a certain way.",
          humanJudgement: "The item is checked only by a person's judgement, with no stated rubric or criterion.",
          environment: "The item holds only in a particular environment, device, network or load that is not specified.",
          timeBound: "The item holds only at a particular time or season, so a check at another time says nothing.",
        },
      },
    },
  },
  consistency: {
    scope: "set",
    criterion: "Some of these items cannot all hold at once: they contradict, pull against each other, repeat each other, depend on each other in a loop, or disagree on scope.",
    children: {
      contradiction: {
        scope: "pair", level: "error",
        criterion: "Two items cannot both hold of the same system: one requires, permits or bounds what the other forbids or exceeds.",
        children: {
          modal: "One item says must or always where the other says must not, never or may not.",
          quantity: "The items give incompatible numbers, limits or amounts for the same thing.",
          state: "The items require the same thing to be in incompatible states at the same time.",
          actor: "The items assign the same action or decision to different actors who cannot both own it.",
          timing: "The items require incompatible timing or order for the same event.",
        },
      },
      tension: {
        scope: "pair",
        criterion: "Two items could both hold, but only with a trade-off or an assumption neither states, so building one weakens the other.",
        children: {
          resource: "The items compete for the same budget, capacity or resource without saying which wins.",
          timing: "The items pull the schedule or response time in opposite directions.",
          priority: "The items each claim top priority, or rank the same goals differently.",
          unstatedAssumption: "The items are compatible only under an assumption that neither states.",
        },
      },
      duplicate: {
        scope: "pair",
        criterion: "Two items say the same thing, or one is wholly contained in the other, so one of them is redundant.",
        children: {
          exact: "The items have the same or nearly the same wording.",
          paraphrase: "The items say the same thing in different words.",
          subsumed: "One item is a special case of the other and adds nothing to it.",
          splitAcrossSections: "The same item is stated in two sections, possibly with small differences.",
        },
      },
      circular: {
        scope: "pair",
        criterion: "The items depend on each other in a loop, so neither can be built, defined or checked first.",
        children: {
          dependency: "Each item requires the other to be done or true before it can be.",
          definition: "Each item's meaning is defined in terms of the other.",
          verification: "Each item is checked only by appeal to the other.",
          authorization: "Each item is permitted only on the authority of the other, so neither is ever authorised first.",
        },
      },
      scopeClash: {
        scope: "pair", level: "error",
        criterion: "The items disagree about who or what something applies to: one is narrower or broader than the other allows.",
        children: {
          permissionNarrower: "A rule or policy permits a narrower group than another item needs to act.",
          ownerVsShared: "One item treats something as owned by one person while another treats it as shared.",
          roleMismatch: "The items assign the same capability to roles that do not match.",
          conditional: "One item applies only under a condition that another item ignores or contradicts.",
        },
      },
    },
  },
  coherence: {
    scope: "whole",
    criterion: "The parts do not fit the whole: a summary misstates its parts, items drift from the purpose, terms shift meaning, or items sit in the wrong place or point at nothing.",
    children: {
      summaryMismatch: {
        scope: "set",
        criterion: "A parent's summary or description does not match what its children say.",
        children: {
          omits: "The summary leaves out something important that the children state.",
          contradicts: { level: "error", criterion: "The summary says something that one of the children contradicts." },
          overclaims: "The summary promises more than the children deliver.",
          stale: "The summary describes an earlier version of the children that no longer matches them.",
        },
      },
      purposeDrift: {
        scope: "node",
        criterion: "The item does not serve the stated purpose of the product or its section.",
        children: {
          offPurpose: "The item serves a goal the purpose does not mention.",
          beneficiaryMismatch: "The item benefits a different user or party than the purpose names.",
          outcomeMismatch: "The item leads to a different outcome than the one the purpose aims at.",
          beyondScope: "The item reaches beyond the scope the purpose or section sets.",
        },
      },
      termDrift: {
        criterion: "A term is used inconsistently across the specification, so readers may take it to mean different things.",
        children: {
          synonyms: "Different words are used for the same thing in different places.",
          homonym: "The same word is used for different things in different places.",
          unitDrift: "The same quantity is given in different units or scales in different places.",
          nameDrift: "The same item or role is named differently in different places.",
        },
      },
      misplaced: {
        scope: "node",
        criterion: "The item is in the wrong place: it belongs in another section, under another parent or layer, or should be a link rather than an item.",
        children: {
          wrongSection: "The item belongs in a different section of the specification.",
          wrongParent: "The item belongs under a different parent than the one it is filed under.",
          wrongLayer: "The item belongs to a different layer, for example a design detail filed among goals.",
          shouldBeRelation: "The item only states a connection between two other items and should be a link between them.",
        },
      },
      orphanReference: {
        scope: "node",
        criterion: "The item refers to something the specification does not define or contain.",
        children: {
          undefinedTerm: "The item uses a term the specification never defines.",
          missingNode: "The item refers to a feature, rule or section that does not exist in the specification.",
          danglingLink: "The item links or points to an item that is missing or was removed.",
          externalAssumed: "The item assumes an external system or document the specification never names.",
        },
      },
    },
  },
};

function flatten(): Defect[] {
  const out: Defect[] = [];
  const walk = (label: string, raw: Spec | string, parent?: Defect) => {
    const s: Spec = typeof raw === "string" ? { criterion: raw } : raw;
    const d: Defect = {
      id: parent ? `${parent.id}.${label}` : label,
      ...(parent && { parent: parent.id }),
      scope: s.scope ?? parent?.scope ?? "node",
      label,
      criterion: s.criterion,
      level: s.level ?? parent?.level ?? "warning",
      ...(s.deterministic && { deterministic: s.deterministic }),
    };
    out.push(d);
    for (const [k, c] of Object.entries(s.children ?? {})) walk(k, c, d);
  };
  for (const [k, s] of Object.entries(TREE)) walk(k, s);
  return out;
}

/** The full taxonomy, parents before children. */
export const DEFECTS: readonly Defect[] = Object.freeze(flatten());

export const defectIndex = (defects: readonly Defect[] = DEFECTS): Map<string, Defect> => new Map(defects.map((d) => [d.id, d]));

/** Root to `id`, inclusive; empty when `id` is unknown. */
export function defectPath(id: string, defects: readonly Defect[] = DEFECTS): Defect[] {
  const idx = defectIndex(defects);
  const path: Defect[] = [];
  const seen = new Set<string>();
  for (let d = idx.get(id); d && !seen.has(d.id); d = d.parent === undefined ? undefined : idx.get(d.parent)) {
    seen.add(d.id);
    path.unshift(d);
  }
  return path;
}

/** Direct children of `id` in declaration order. */
export const defectChildren = (id: string, defects: readonly Defect[] = DEFECTS): Defect[] => defects.filter((d) => d.parent === id);

/** One leaf under `instance.otherKind` per kind, for vocabularies that declare a glossary. */
export const otherKindDefects = (kinds: Record<string, string> | string[]): Defect[] =>
  (Array.isArray(kinds) ? kinds.map((k) => [k, k] as const) : Object.entries(kinds)).map(([k, noun]) => ({
    id: `${OTHER_KIND}.${k}`, parent: OTHER_KIND, scope: "node", label: k, level: "warning",
    criterion: `The item is really a ${noun}, not an instance of the kind it is filed as.`.slice(0, 255),
  }));

/**
 * Applies a template's `defects` block: `disable` drops each named defect with its subtree, `levels` overrides a
 * defect's own level. Ids not in `base` are returned in `unknown` (meta@1 reports them) instead of throwing.
 */
export function mergeDefects(base: readonly Defect[], cfg: Partial<DefectsConfig> = {}): { defects: Defect[]; unknown: string[] } {
  const idx = defectIndex(base);
  const disable = cfg.disable ?? [];
  const levels = cfg.levels ?? {};
  const unknown = [...new Set([...disable, ...Object.keys(levels)].filter((id) => !idx.has(id)))].sort();
  const off = new Set(disable.filter((id) => idx.has(id)));
  const dropped = (d: Defect): boolean => {
    for (let x: Defect | undefined = d; x; x = x.parent === undefined ? undefined : idx.get(x.parent)) if (off.has(x.id)) return true;
    return false;
  };
  const defects = base.filter((d) => !dropped(d)).map((d) => (levels[d.id] && levels[d.id] !== d.level ? { ...d, level: levels[d.id]! } : d));
  return { defects, unknown };
}
