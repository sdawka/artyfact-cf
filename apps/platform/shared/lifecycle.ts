import type { ArtifactBinding, Candidate, CandidateModel, Evaluation, GenomeCandidateReview, SystemCommit, SystemManifest } from './api';
import type { CriterionLayer, SemanticDelta, TaskAnalysis, TaskDefinition } from '@artyfact/model';
export type { TaskAnalysis, TaskDefinition, TaskFootprint, TaskConflict } from '@artyfact/model';
export type { CriterionLayer } from '@artyfact/model';
/** The pinned Genome tree the platform committed into a Task fork at claim (docs/design/task-fork-model.md §1). */
export interface TaskModel { prefix:'system'; genomeCommit:string; /** The fork commit that pins the Genome under `prefix/`; the agent's clone starts here. */ commit:string }
export interface CreateRealizationPlanRequest { title: string; genomeCommit?: string; tasks: Omit<TaskDefinition, 'footprint'>[] }
export interface RealizationPlan { id: string; systemId: string; title: string; genome: {repo:string; commit:string}; baseHead:string|null; baseManifest:SystemManifest; ontologyDigest:string; status:'planned'|'implementing'|'integrated'|'promoted'; tasks:Task[]; analysis:TaskAnalysis; integration:IntegratedBinding[]; createdAt:string; updatedAt:string }
export interface Task extends TaskDefinition { planId:string; status:'pending'|'claimed'|'working'|'submitted'|'selected'|'completed'; base:ArtifactBinding; forkRepo:string; attempts:TaskAttempt[]; selectedCandidate:string|null;
  /** Set once the fork holds the pinned Genome under `system/` (after the first successful claim). */
  model?:TaskModel }
export interface TaskAttempt { id:string; taskId:string; generation:number; realizationId:string; status:'claimed'|'working'|'submitted'|'ended'; agentLabel:string; leaseExpiresAt:string; createdAt:string }
export interface TaskClaimRequest { agentLabel?:string; leaseSeconds?:number }
export interface TaskAttemptRequest { attemptId:string; generation:number }
export interface TaskCheckpointRequest extends TaskAttemptRequest { message:string; commit?:string }
export interface TaskSubmitRequest extends TaskAttemptRequest { commit:string; previewUrl?:string }
export interface TaskSelectRequest { candidateId:string }
export interface TaskStartResponse { plan:RealizationPlan; task:Task; attempt:TaskAttempt; secret:string; token:{value:string; expiresAt:string; remote:string}; remote:string; packet:LifecycleTaskPacket; reviewUrl:string }
export interface LifecycleTaskPacket { systemId:string; planId:string; taskId:string; attemptId:string; generation:number; genome:{repo:string; commit:string}; artifactId:string; workspace:{repo:string; fork:string; baseCommit:string; remote:string}; steps:string[]; dependsOn:string[]; readNodes:string[]; writeNodes:string[]; permittedGlobs:string[]; checks:string[]; reviewUrl:string; markdown:string;
  /** 1-based wave of the task in `plan.analysis.waves`; null when the task is in none. */
  wave?:number|null;
  /** Plain-language independence statement: which tasks share no scope, which conflict, and what to leave alone. */
  independence?:string;
  /** All other open tasks' write globs, minus any that overlap this task's own permitted globs or paths. */
  doNotTouch?:{taskId:string; globs:string[]}[];
  /** Other tasks of the plan that may run at the same time. */
  concurrent?:PacketTaskRef[];
  /** Selected dependency tasks. Same-binding ones are already in this task's base; others are not in the fork and are named for context. */
  buildsOn?:{taskId:string; title:string; candidateId:string|null}[];
  /** AGENTS.md for the task workspace. The CLI writes it when present, else its fixed text. */
  agentsMd?:string;
  /** Layer of each id in `checks` (genome | realization | phenome; `layerOf` in @artyfact/model). */
  checkLayers?:Record<string,CriterionLayer>;
  /** The pinned model in the fork: where it is and the file of every read and write node (repo paths under `prefix/`). */
  model?:{prefix:'system'; genomeCommit:string; nodeFiles:Record<string,string>} }
/** A task named in a packet. */
export interface PacketTaskRef { taskId:string; title:string; status:Task['status']; wave:number|null }

/**
 * `POST /api/systems/:id/realization-plans/draft` (admin): an editable draft of a plan; persists nothing.
 * `evolutionIds`: accepted, not-yet-realized Genome Evolutions whose affected nodes to implement; `nodes`: explicit
 * node ids (added to the Evolutions' nodes); `hint`: free text for the planner. Guarded by `import-unreviewed`.
 */
export interface DraftRealizationPlanRequest { title?:string; evolutionIds?:string[]; nodes?:string[]; hint?:string }
/** A problem with the draft; `taskId` absent means the whole draft. */
export interface DraftPlanProblem { taskId?:string; severity:'error'|'missing'|'warning'; message:string }
/** Who drafted it and from what. `fallback`: the deterministic partition was used instead of (or after) the LLM. */
export interface DraftPlanProvenance { planner:{provider:string; model:string}; genomeCommit:string; evolutionIds:string[]; nodes:string[]; fake:boolean; fallback:boolean }
/** `request` posts unchanged to `lifecyclePaths.plans` (create); `analysis` is computed over the draft's footprints. */
export interface DraftRealizationPlanResponse { request:CreateRealizationPlanRequest; analysis:TaskAnalysis; problems:DraftPlanProblem[]; provenance:DraftPlanProvenance }
/** Evidence pinned to one immutable Task candidate, including its actual source/base and recorded checks. */
export interface TaskCandidateReview { candidate:Candidate; manifest:{planId:string;taskId:string;realizationId:string;repo:string;baseRepo:string;baseCommit:string;commit:string;manifestHash:string;changedPaths:string[]}; evaluations:Evaluation[];
  /** The candidate's model delta (its `system/` vs the pinned Genome) with System One's review of it; absent when `system/` is untouched. */
  model?:TaskCandidateModelReview }
/** `review` has the Genome amendment review's shape (semantic changes, readiness before and after, System One signals). */
export interface TaskCandidateModelReview { prefix:'system'; genomeCommit:string; changedPaths:string[]; changedNodes:string[]; delta:SemanticDelta; review:GenomeCandidateReview|null; loadError?:string }
export interface TaskReview { plan:RealizationPlan; task:Task; candidates:TaskCandidateReview[];
  /** Layer of every criterion the candidates' evaluations name, for grouping evidence. */
  layers:Record<string,CriterionLayer> }
export interface TaskSubmitResponse { plan:RealizationPlan; task:Task; candidate:Candidate; evaluations:Evaluation[] }
export interface IntegratedBinding { artifactId:string; source:ArtifactBinding; candidateId:string; taskCandidates:string[]; realizedGenome:string;
  /** The integrated model delta (the integrated commit's `system/` vs the pinned Genome); absent when no task changed the model. */
  model?:CandidateModel }
export interface ImplementationReview { plan:RealizationPlan; bindings:IntegratedBinding[]; candidates:Candidate[]; evaluations:Evaluation[]; ready:boolean; blockers:string[]; expectedHead:string|null;
  /** Layer of every criterion the evaluations name. */
  layers?:Record<string,CriterionLayer>;
  /** Set when an integrated binding carries a model delta: promotion needs `acceptModelDelta` and moves the Genome to `source`. */
  modelDelta?:{source:ArtifactBinding; model:CandidateModel} }
/** `acceptModelDelta` must be true when the review shows a `modelDelta`; promotion then also moves the accepted Genome (409 `model-delta-unreviewed` otherwise). */
export interface PlanPromoteRequest { expectedHead:string|null; rationale:string; candidateIds:string[]; acceptModelDelta?:boolean }
export interface PlanPromoteResponse { plan:RealizationPlan; commit:SystemCommit }
const enc=encodeURIComponent, root=(s:string)=>`/api/systems/${enc(s)}/realization-plans`;
export const lifecyclePaths={ plans:root, draft:(s:string)=>`${root(s)}/draft`, plan:(s:string,p:string)=>`${root(s)}/${enc(p)}`, taskReview:(s:string,p:string,t:string)=>`${root(s)}/${enc(p)}/tasks/${enc(t)}/review`, taskReviewFile:(s:string,p:string,t:string,c:string,path:string)=>`${root(s)}/${enc(p)}/tasks/${enc(t)}/review/files?candidateId=${enc(c)}&path=${enc(path)}`, task:(s:string,p:string,t:string)=>`${root(s)}/${enc(p)}/tasks/${enc(t)}`, action:(s:string,p:string,t:string,a:'claim'|'start'|'resume'|'checkpoint'|'submit'|'select')=>`${root(s)}/${enc(p)}/tasks/${enc(t)}/${a}`, integrate:(s:string,p:string)=>`${root(s)}/${enc(p)}/integrate`, review:(s:string,p:string)=>`${root(s)}/${enc(p)}/review`, reviewFile:(s:string,p:string,artifactId:string,path:string)=>`${root(s)}/${enc(p)}/review/files?artifactId=${enc(artifactId)}&path=${enc(path)}`, promote:(s:string,p:string)=>`${root(s)}/${enc(p)}/promote` };

export interface TaskStatusResponse { task:Task; planId:string; genome:{repo:string;commit:string} }
