import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminToken } from '@/api/adminToken';
import { useKeepParams,useSystemRoute } from '@/model/useSelection';
import { FIXTURE_REASON,TOKEN_REASON,planError } from '../work/plan/lib';
import { useApiMode,usePlan } from '../work/plan/queries';
import { PlanReview } from './PlanReview';
import { TaskReview } from './TaskReview';

export function PlanDecision({planId,taskId}:{planId:string;taskId:string|null}) {
 const {systemId}=useSystemRoute();const api=useApiMode(),detail=usePlan(systemId,planId,api),{token}=useAdminToken(),qc=useQueryClient(),href=useKeepParams();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const writeReason=!api?FIXTURE_REASON:!token?TOKEN_REASON:null;
 const run=(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');void fn().catch(e=>setError(planError('This decision',e))).finally(async()=>{await Promise.all(['plans','plan','task-review','implementation-review','systems','evolutions','history'].map(key=>qc.invalidateQueries({queryKey:key==='systems'?[key]:[key,systemId]})));setBusy(false);});};
 if(!api)return <p>{FIXTURE_REASON}</p>;
 if(detail.isLoading)return <p role="status">Loading plan…</p>;
 if(detail.error)return <p role="alert">{planError('Reading the plan',detail.error)}</p>;
 if(!detail.data)return <p role="alert">No plan {planId} on this System.</p>;
 const plan=detail.data;
 return <><Link to={href('work',{plan:planId,task:taskId,panel:null,evolution:null,realization:null})}>Open execution plan</Link>
 {taskId&&!plan.tasks.some(t=>t.id===taskId)?<p role="alert">No Task {taskId} in plan {planId}.</p>:taskId?<TaskReview key={taskId} plan={plan} taskId={taskId} writeReason={writeReason} busy={busy} run={run}/>:<PlanReview plan={plan} writeReason={writeReason} busy={busy} run={run}/>}
 {error&&<p role="alert">{error}</p>}</>;
}
