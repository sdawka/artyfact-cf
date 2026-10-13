import type { ArtifactBinding, Candidate, Evaluation, SystemCommit, SystemManifest } from './api';
import type { TaskAnalysis, TaskDefinition } from '@artyfact/model';
export type { TaskAnalysis, TaskDefinition, TaskFootprint, TaskConflict } from '@artyfact/model';
export interface CreateRealizationPlanRequest { title: string; genomeCommit?: string; tasks: Omit<TaskDefinition, 'footprint'>[] }
export interface RealizationPlan { id: string; systemId: string; title: string; genome: {repo:string; commit:string}; baseHead:string|null; baseManifest:SystemManifest; ontologyDigest:string; status:'planned'|'implementing'|'integrated'|'promoted'; tasks:Task[]; analysis:TaskAnalysis; integration:IntegratedBinding[]; createdAt:string; updatedAt:string }
export interface Task extends TaskDefinition { planId:string; status:'pending'|'claimed'|'working'|'submitted'|'selected'|'completed'; base:ArtifactBinding; forkRepo:string; attempts:TaskAttempt[]; selectedCandidate:string|null }
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
  /** Other live tasks' write globs this task must not edit (minus its own). */
  doNotTouch?:{taskId:string; globs:string[]}[];
  /** Other tasks of the plan that may run at the same time. */
  concurrent?:PacketTaskRef[];
  /** Dependencies whose selected candidates are in this task's base. */
  buildsOn?:{taskId:string; title:string; candidateId:string|null}[];
  /** AGENTS.md for the task workspace. The CLI writes it when present, else its fixed text. */
  agentsMd?:string }
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
export interface TaskSubmitResponse { plan:RealizationPlan; task:Task; candidate:Candidate; evaluations:Evaluation[] }
export interface IntegratedBinding { artifactId:string; source:ArtifactBinding; candidateId:string; taskCandidates:string[]; realizedGenome:string }
export interface ImplementationReview { plan:RealizationPlan; bindings:IntegratedBinding[]; candidates:Candidate[]; evaluations:Evaluation[]; ready:boolean; blockers:string[]; expectedHead:string|null }
export interface PlanPromoteRequest { expectedHead:string|null; rationale:string; candidateIds:string[] }
export interface PlanPromoteResponse { plan:RealizationPlan; commit:SystemCommit }
const enc=encodeURIComponent, root=(s:string)=>`/api/systems/${enc(s)}/realization-plans`;
export const lifecyclePaths={ plans:root, draft:(s:string)=>`${root(s)}/draft`, plan:(s:string,p:string)=>`${root(s)}/${enc(p)}`, task:(s:string,p:string,t:string)=>`${root(s)}/${enc(p)}/tasks/${enc(t)}`, action:(s:string,p:string,t:string,a:'claim'|'start'|'resume'|'checkpoint'|'submit'|'select')=>`${root(s)}/${enc(p)}/tasks/${enc(t)}/${a}`, integrate:(s:string,p:string)=>`${root(s)}/${enc(p)}/integrate`, review:(s:string,p:string)=>`${root(s)}/${enc(p)}/review`, reviewFile:(s:string,p:string,artifactId:string,path:string)=>`${root(s)}/${enc(p)}/review/files?artifactId=${enc(artifactId)}&path=${enc(path)}`, promote:(s:string,p:string)=>`${root(s)}/${enc(p)}/promote` };

export interface TaskStatusResponse { task:Task; planId:string; genome:{repo:string;commit:string} }
