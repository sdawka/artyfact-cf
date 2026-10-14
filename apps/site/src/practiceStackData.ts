export type Discipline = 'Engineering' | 'Product' | 'Data' | 'Operations';
export type Practice = { discipline: Discipline; replaces: string; artyfact: string; term?: string; status: 'yes' | 'partial'; note?: string };

/** Each claim is checked against the platform and packages; partial work says so. */
export const practices: Practice[] = [
  { discipline: 'Engineering', replaces: 'git worktrees, a branch per agent', artyfact: 'A private fork for each agent Task, with a short-lived write token.', term: 'Task', status: 'yes' },
  { discipline: 'Engineering', replaces: 'AGENTS.md and prompt files', artyfact: 'A brief for each Task, cut from the model: what it changes, which paths it may write, its steps, dependencies and checks.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'spec.md and spec-driven development', artyfact: 'A typed, multi-level model of the product. It is validated and versioned.', term: 'Genome', status: 'yes' },
  { discipline: 'Engineering', replaces: 'linters and policy-as-code', artyfact: 'Rule packs over the model. Each finding shows the facts that produced it.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'CI gates', artyfact: 'Checks bound to criteria. A check that did not run stays unknown. Only pass is green.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'merge queues and branch protection', artyfact: 'A compare-and-swap promote. It refuses work reviewed against an outdated head.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'merge conflicts', artyfact: 'Tasks that change the same part of the model are flagged and run in order, even when their files differ.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'changelogs and release notes', artyfact: 'A changelog of every System commit. Compare the model or the files.', term: 'System', status: 'yes' },
  { discipline: 'Engineering', replaces: 'boilerplate and templates', artyfact: 'Reusable pieces with pinned versions. Composition records where each piece came from.', term: 'Parts', status: 'yes' },
  { discipline: 'Engineering', replaces: 'LLM evals', artyfact: 'AI judgments with a confidence score. Below the threshold they stay unknown, never green.', status: 'yes' },
  { discipline: 'Product', replaces: 'PRDs', artyfact: 'Purposes with success criteria, non-goals and constraints, inside the model.', status: 'yes' },
  { discipline: 'Product', replaces: 'personas', artyfact: 'The people and groups each purpose serves.', status: 'yes' },
  { discipline: 'Product', replaces: 'journey maps', artyfact: 'Journeys whose steps point at real screens and operations. A rule pack checks that they connect.', status: 'yes' },
  { discipline: 'Product', replaces: 'definition of done', artyfact: 'Acceptance criteria bound to the checks that gate promotion.', status: 'yes' },
  { discipline: 'Product', replaces: 'backlogs and change requests', artyfact: 'Change requests reviewed from purpose down to each affected subject. Accepting one records a new model revision.', term: 'Evolution', status: 'yes' },
  { discipline: 'Product', replaces: 'OKRs and hypotheses', artyfact: 'A theory of change with indicators and evaluation methods.', status: 'partial', note: 'Measurement in progress' },
  { discipline: 'Data', replaces: 'ERDs and schema docs', artyfact: 'Entities and their fields, in the model.', status: 'yes' },
  { discipline: 'Data', replaces: 'privacy reviews', artyfact: 'Access policies in the model. A rule flags every data-writing operation that no policy governs.', status: 'yes' },
  { discipline: 'Data', replaces: 'tracking plans', artyfact: 'Runtime events stamped with the build and commit that sent them.', status: 'yes' },
  { discipline: 'Operations', replaces: 'release tracking', artyfact: 'Every deployment tied to a System commit.', status: 'yes' },
  { discipline: 'Operations', replaces: 'drift dashboards', artyfact: '“Deployed, behind” when production runs an older commit.', status: 'yes' },
  { discipline: 'Operations', replaces: 'health checks', artyfact: 'A health check against each candidate’s preview build.', status: 'yes' },
  { discipline: 'Operations', replaces: 'feature flag dashboards', artyfact: 'Feature flags next to deployments and metrics.', status: 'yes' },
];
export const disciplines: Discipline[] = ['Engineering', 'Product', 'Data', 'Operations'];
