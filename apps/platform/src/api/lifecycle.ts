import type { FileCompare } from "../../shared/api";
import { ApiRequestError } from './client';
import { lifecyclePaths, type CreateRealizationPlanRequest, type RealizationPlan, type ImplementationReview, type PlanPromoteRequest, type PlanPromoteResponse } from '../../shared/lifecycle';
import type { CreateInitialSystemRequest, CreateInitialSystemResponse, OntologyImportPreviewRequest, OntologyImportReview, OntologyImportAcceptRequest } from '../../shared/ontology-packages';
export { lifecyclePaths };
export async function scopedRequest<T>(path:string,token:string,method='GET',body?:unknown):Promise<T>{
 const res=await fetch(path,{method,headers:{accept:'application/json',...(token?{authorization:`Bearer ${token}`} : {}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await res.json();if(!res.ok)throw new ApiRequestError(res.status,data?.error?.code??`http-${res.status}`,data?.error?.message??res.statusText,data);return data as T;
}
const imports=(s:string)=>`/api/systems/${encodeURIComponent(s)}/ontology-imports`;
export const lifecycleApi={
 initial:(body:CreateInitialSystemRequest,token:string)=>scopedRequest<CreateInitialSystemResponse>('/api/systems/initial',token,'POST',body),
 preview:(s:string,body:OntologyImportPreviewRequest,token:string)=>scopedRequest<OntologyImportReview>(`${imports(s)}/preview`,token,'POST',body),
 importReview:(s:string,id:string,token:string)=>scopedRequest<OntologyImportReview>(`${imports(s)}/${encodeURIComponent(id)}`,token),
 acceptImport:(s:string,id:string,body:OntologyImportAcceptRequest,token:string)=>scopedRequest<OntologyImportReview>(`${imports(s)}/${encodeURIComponent(id)}/accept`,token,'POST',body),
 plans:(s:string,token:string)=>scopedRequest<{plans:RealizationPlan[]}>(lifecyclePaths.plans(s),token),
 plan:(s:string,p:string,token:string)=>scopedRequest<RealizationPlan>(lifecyclePaths.plan(s,p),token),
 createPlan:(s:string,body:CreateRealizationPlanRequest,token:string)=>scopedRequest<RealizationPlan>(lifecyclePaths.plans(s),token,'POST',body),
 reviewFile:(s:string,p:string,artifactId:string,path:string,token:string)=>scopedRequest<FileCompare>(lifecyclePaths.reviewFile(s,p,artifactId,path),token),
 review:(s:string,p:string,token:string)=>scopedRequest<ImplementationReview>(lifecyclePaths.review(s,p),token),
 integrate:(s:string,p:string,token:string)=>scopedRequest<ImplementationReview>(lifecyclePaths.integrate(s,p),token,'POST',{}),
 promote:(s:string,p:string,body:PlanPromoteRequest,token:string)=>scopedRequest<PlanPromoteResponse>(lifecyclePaths.promote(s,p),token,'POST',body),
};
