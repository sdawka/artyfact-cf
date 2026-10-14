export type Discipline = 'Engineering' | 'Product' | 'Data' | 'Operations';
export type Relation = 'built-in' | 'extended' | 'connected';
export type Practice = { discipline: Discipline; known: string; relation: Relation; artyfact: string; term?: string; status: 'yes' | 'partial'; note?: string; link?: { href: string; label: string } };
export const relationLabels: Record<Relation, string> = { 'built-in': 'Built in', extended: 'Extended', connected: 'Connected' };

/** Each claim is checked against the platform and packages; partial work says so.
 * built-in: the practice exists natively in a new shape. extended: kept and given more. connected: your artifact becomes part of the model. */
export const practices: Practice[] = [
  { discipline: 'Engineering', known: 'git worktrees, a branch per agent', relation: 'built-in', artyfact: 'A private fork for each agent Task, with a short-lived write token.', term: 'Task', status: 'yes' },
  { discipline: 'Engineering', known: 'AGENTS.md and prompt files', relation: 'extended', artyfact: 'Each Task workspace gets an AGENTS.md block and a brief cut from the model. The brief lists what the Task changes, the paths it may write, its steps, its dependencies and its checks.', status: 'yes' },
  { discipline: 'Engineering', known: 'spec.md and spec-driven development', relation: 'built-in', artyfact: 'A typed, multi-level model of the product. It is validated and versioned.', term: 'Genome', status: 'yes' },
  { discipline: 'Engineering', known: 'linters and policy-as-code', relation: 'extended', artyfact: 'Rule packs that run over the model. Each finding shows the facts behind it.', status: 'yes' },
  { discipline: 'Engineering', known: 'CI gates', relation: 'extended', artyfact: 'Checks tied to criteria. A check that did not run stays unknown. Only a pass is green.', status: 'yes' },
  { discipline: 'Engineering', known: 'merge queues and branch protection', relation: 'built-in', artyfact: 'A compare-and-swap promote. It refuses work that was reviewed against an old head.', status: 'yes' },
  { discipline: 'Engineering', known: 'merge conflicts', relation: 'extended', artyfact: 'Tasks that touch the same screen, rule or journey are flagged, even in different files.', status: 'yes' },
  { discipline: 'Engineering', known: 'changelogs and release notes', relation: 'extended', artyfact: 'A changelog of every System commit. You can compare the model or the files.', term: 'System', status: 'yes' },
  { discipline: 'Engineering', known: 'boilerplate and templates', relation: 'built-in', artyfact: 'Reusable pieces with pinned versions. Composing them records where each piece came from.', term: 'Parts', status: 'yes' },
  { discipline: 'Engineering', known: 'LLM evals', relation: 'extended', artyfact: 'AI judgments with a confidence score. Below the threshold, a judgment stays unknown. Only a pass is green.', status: 'yes' },
  { discipline: 'Product', known: 'PRDs', relation: 'connected', artyfact: 'Purposes, with success criteria, non-goals and constraints, stored in the model.', status: 'yes' },
  { discipline: 'Product', known: 'personas', relation: 'connected', artyfact: 'The people and groups each purpose is for.', status: 'yes' },
  { discipline: 'Product', known: 'journey maps', relation: 'connected', artyfact: 'Journeys whose steps point at real screens and operations. A rule pack checks that they connect.', status: 'yes' },
  { discipline: 'Product', known: 'definition of done', relation: 'extended', artyfact: 'Acceptance criteria bound to the checks that gate promotion.', status: 'yes' },
  { discipline: 'Product', known: 'backlogs and change requests', relation: 'connected', artyfact: 'Change requests reviewed from the purpose down to each affected part. Accepting one records a new model revision.', term: 'Evolution', status: 'yes' },
  { discipline: 'Product', known: 'OKRs and hypotheses', relation: 'connected', artyfact: 'A theory of change with indicators and evaluation methods.', status: 'partial', note: 'Measurement in progress', link: { href: '/model', label: 'Theory Driven Development' } },
  { discipline: 'Data', known: 'ERDs and schema docs', relation: 'connected', artyfact: 'Entities and their fields, in the model.', status: 'yes' },
  { discipline: 'Data', known: 'privacy reviews', relation: 'connected', artyfact: 'Access policies in the model. A rule flags any operation that writes data without a policy.', status: 'yes' },
  { discipline: 'Data', known: 'tracking plans', relation: 'connected', artyfact: 'Runtime events stamped with the build and commit that sent them.', status: 'yes' },
  { discipline: 'Operations', known: 'release tracking', relation: 'built-in', artyfact: 'Each deployment is tied to a System commit.', status: 'yes' },
  { discipline: 'Operations', known: 'drift dashboards', relation: 'built-in', artyfact: '“Deployed, behind” when production runs an older commit.', status: 'yes' },
  { discipline: 'Operations', known: 'health checks', relation: 'extended', artyfact: 'A health check on each candidate’s preview build.', status: 'yes' },
  { discipline: 'Operations', known: 'feature flag dashboards', relation: 'connected', artyfact: 'Feature flags shown next to deployments and metrics.', status: 'yes' },
];
export const disciplines: Discipline[] = ['Engineering', 'Product', 'Data', 'Operations'];
