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
export interface LifecycleTaskPacket { systemId:string; planId:string; taskId:string; attemptId:string; generation:number; genome:{repo:string; commit:string}; artifactId:string; workspace:{repo:string; fork:string; baseCommit:string; remote:string}; steps:string[]; dependsOn:string[]; readNodes:string[]; writeNodes:string[]; permittedGlobs:string[]; checks:string[]; reviewUrl:string; markdown:string }
export interface TaskSubmitResponse { plan:RealizationPlan; task:Task; candidate:Candidate; evaluations:Evaluation[] }
export interface IntegratedBinding { artifactId:string; source:ArtifactBinding; candidateId:string; taskCandidates:string[]; realizedGenome:string }
export interface ImplementationReview { plan:RealizationPlan; bindings:IntegratedBinding[]; candidates:Candidate[]; evaluations:Evaluation[]; ready:boolean; blockers:string[]; expectedHead:string|null }
export interface PlanPromoteRequest { expectedHead:string|null; rationale:string; candidateIds:string[] }
export interface PlanPromoteResponse { plan:RealizationPlan; commit:SystemCommit }
const enc=encodeURIComponent, root=(s:string)=>`/api/systems/${enc(s)}/realization-plans`;
export const lifecyclePaths={ plans:root, plan:(s:string,p:string)=>`${root(s)}/${enc(p)}`, task:(s:string,p:string,t:string)=>`${root(s)}/${enc(p)}/tasks/${enc(t)}`, action:(s:string,p:string,t:string,a:'claim'|'start'|'resume'|'checkpoint'|'submit'|'select')=>`${root(s)}/${enc(p)}/tasks/${enc(t)}/${a}`, integrate:(s:string,p:string)=>`${root(s)}/${enc(p)}/integrate`, review:(s:string,p:string)=>`${root(s)}/${enc(p)}/review`, reviewFile:(s:string,p:string,artifactId:string,path:string)=>`${root(s)}/${enc(p)}/review/files?artifactId=${enc(artifactId)}&path=${enc(path)}`, promote:(s:string,p:string)=>`${root(s)}/${enc(p)}/promote` };

export interface TaskStatusResponse { task:Task; planId:string; genome:{repo:string;commit:string} }
