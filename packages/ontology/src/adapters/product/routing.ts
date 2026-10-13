/**
 * Kind-to-space map and short wording for routing user messages over a product graph. Spaces, their order and each
 * kind's space follow lfp `src/kernel.ts` SPACES and KINDS (2026-10-13): outcome and goal sit in `problem`, term and
 * design-system in `solution`, infrastructure and asset in `current`.
 */
export const PRODUCT_SPACES: Record<string, string[]> = {
  basics: ["name", "purpose", "summary"],
  problem: ["audience", "context", "usecase", "problem", "outcome", "goal"],
  hypothesis: ["hypothesis", "assumption", "metric"],
  solution: [
    "capability", "feature", "flow", "term", "system", "external", "module", "infra", "thing", "rule", "interface", "event",
    "protocol", "test", "screen", "design-system", "agent", "ai-function",
  ],
  current: ["repository", "codebase", "infrastructure", "practice", "asset", "test-result"],
  planned: ["epic", "task"],
  effects: ["metric-reading", "usage-event", "feedback", "evidence"],
};

/** Space blurbs from the lfp kernel, used as the option criteria of the space question. */
export const PRODUCT_SPACE_LABELS: Record<string, string> = {
  basics: "Basics: name, purpose and the one-paragraph summary",
  problem: "Problem: who it is for, in what context, with what problems, wanting what outcomes and goals",
  hypothesis: "Bets: the bets (hypotheses) we make, what we assume, and the metrics that tell us",
  solution: "Solution: capabilities, features, flows, screens, agents, AI functions, domain things, rules, tests, modules, interfaces, events, vocabulary and architecture",
  current: "Current state: repositories, code, infrastructure, practices, assets and current test results",
  planned: "Planned changes: epics and the coding tasks under them",
  effects: "Effects: metric readings, usage events, user feedback and evidence from reality",
};

/** Kind blurbs from the lfp kernel, shortened; used as the option criteria of the kind question. */
export const PRODUCT_KIND_LABELS: Record<string, string> = {
  name: "Name: what the system is called",
  purpose: "Purpose: why it exists",
  summary: "Summary: a paragraph describing the project",
  audience: "Audience: a type of person or agent the system is for",
  context: "Context: the situation an audience is in",
  usecase: "Use case: something an audience is trying to get done",
  problem: "Problem: what stands in their way today",
  outcome: "Outcome: the change we want for the audience; measurable",
  goal: "Goal: a strategic target stated as a compound of metrics",
  hypothesis: "Bet: a bet linking what we build to an outcome",
  assumption: "Assumption: taken as true until reality says otherwise",
  metric: "Metric: how an outcome or bet is measured",
  capability: "Capability: a high-level thing the system can do",
  feature: "Feature: a value grouping described by flows",
  flow: "Flow: a happy path through the system, with steps",
  term: "Term: a fixed word of the domain and its definition",
  system: "System: the system itself or a separate part of it",
  external: "External system: another system ours talks to",
  module: "Module: a business domain that exposes an interface",
  infra: "Infra: a deployable such as a server, store, cache or queue",
  thing: "Thing: an entity in domain language",
  rule: "Rule: logic or a constraint about one or more things",
  interface: "Interface: the API a module exposes",
  event: "Event: something notable that happened in the system",
  protocol: "Protocol: how we enact the representation (PR gates, audits)",
  test: "Test: one condition of a rule, checked in reality",
  screen: "Screen: a user interface",
  "design-system": "Design system: guides product material and tone",
  agent: "Agent: executes actions for one or more features",
  "ai-function": "AI function: a named place the AI acts, with prompt and output",
  repository: "Repository: where the code lives",
  codebase: "Code: a reference into the repository",
  infrastructure: "Infrastructure: what is actually provisioned and running",
  practice: "Practice: process flows, CI and conventions in force",
  asset: "Asset: a non-code artefact in force",
  "test-result": "Test result: whether a test passes in reality right now",
  epic: "Epic: a planned change, Jira-epic sized",
  task: "Task: a targeted coding task naming the tests it must turn green",
  "metric-reading": "Metric reading: a value of a metric at a time",
  "usage-event": "Usage event: something a user did, measured",
  feedback: "Feedback: what users said, in their words",
  evidence: "Evidence: an observation from reality tied to a bet or metric",
};
