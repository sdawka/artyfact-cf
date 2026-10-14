export type Discipline = 'Engineering' | 'Product' | 'Data' | 'Operations';
export type Practice = { discipline: Discipline; replaces: string; artyfact: string; term?: string; status: 'yes' | 'partial'; note?: string };

/** Each claim is checked against the platform and packages; partial work says so. */
export const practices: Practice[] = [
  { discipline: 'Engineering', replaces: 'git worktrees, a branch per agent', artyfact: 'A private fork for each agent Task, with a short-lived write token.', term: 'Task', status: 'yes' },
  { discipline: 'Engineering', replaces: 'AGENTS.md and prompt files', artyfact: 'A brief for each Task, cut from the model. It lists what the Task changes, the paths it may write, its steps, its dependencies and its checks.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'spec.md and spec-driven development', artyfact: 'A typed, multi-level model of the product. It is validated and versioned.', term: 'Genome', status: 'yes' },
  { discipline: 'Engineering', replaces: 'linters and policy-as-code', artyfact: 'Rule packs that run over the model. Each finding shows the facts behind it.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'CI gates', artyfact: 'Checks tied to criteria. A check that did not run stays unknown. Only a pass is green.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'merge queues and branch protection', artyfact: 'A compare-and-swap promote. It refuses work that was reviewed against an old head.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'merge conflicts', artyfact: 'Tasks that change the same part of the model are flagged and run in order, even if they touch different files.', status: 'yes' },
  { discipline: 'Engineering', replaces: 'changelogs and release notes', artyfact: 'A changelog of every System commit. You can compare the model or the files.', term: 'System', status: 'yes' },
  { discipline: 'Engineering', replaces: 'boilerplate and templates', artyfact: 'Reusable pieces with pinned versions. Composing them records where each piece came from.', term: 'Parts', status: 'yes' },
  { discipline: 'Engineering', replaces: 'LLM evals', artyfact: 'AI judgments with a confidence score. Below the threshold, a judgment stays unknown, never green.', status: 'yes' },
  { discipline: 'Product', replaces: 'PRDs', artyfact: 'Purposes, with success criteria, non-goals and constraints, stored in the model.', status: 'yes' },
  { discipline: 'Product', replaces: 'personas', artyfact: 'The people and groups each purpose is for.', status: 'yes' },
  { discipline: 'Product', replaces: 'journey maps', artyfact: 'Journeys whose steps point at real screens and operations. A rule pack checks that they connect.', status: 'yes' },
  { discipline: 'Product', replaces: 'definition of done', artyfact: 'Acceptance criteria bound to the checks that gate promotion.', status: 'yes' },
  { discipline: 'Product', replaces: 'backlogs and change requests', artyfact: 'Change requests reviewed from the purpose down to each affected part. Accepting one records a new model revision.', term: 'Evolution', status: 'yes' },
  { discipline: 'Product', replaces: 'OKRs and hypotheses', artyfact: 'A theory of change with indicators and evaluation methods.', status: 'partial', note: 'Measurement in progress' },
  { discipline: 'Data', replaces: 'ERDs and schema docs', artyfact: 'Entities and their fields, in the model.', status: 'yes' },
  { discipline: 'Data', replaces: 'privacy reviews', artyfact: 'Access policies in the model. A rule flags any operation that writes data without a policy.', status: 'yes' },
  { discipline: 'Data', replaces: 'tracking plans', artyfact: 'Runtime events stamped with the build and commit that sent them.', status: 'yes' },
  { discipline: 'Operations', replaces: 'release tracking', artyfact: 'Each deployment is tied to a System commit.', status: 'yes' },
  { discipline: 'Operations', replaces: 'drift dashboards', artyfact: '“Deployed, behind” when production runs an older commit.', status: 'yes' },
  { discipline: 'Operations', replaces: 'health checks', artyfact: 'A health check on each candidate’s preview build.', status: 'yes' },
  { discipline: 'Operations', replaces: 'feature flag dashboards', artyfact: 'Feature flags shown next to deployments and metrics.', status: 'yes' },
];
export const disciplines: Discipline[] = ['Engineering', 'Product', 'Data', 'Operations'];
