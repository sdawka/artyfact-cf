import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAdminToken } from '@/api/adminToken';
import { invalidatePlanDecision } from '@/api/queries';
import { useKeepParams,useSystemRoute } from '@/model/useSelection';
import { FIXTURE_REASON,TOKEN_REASON,planError } from '../work/plan/lib';
import { useApiMode,usePlan } from '../work/plan/queries';
import { PlanReview } from './PlanReview';
import { TaskReview } from './TaskReview';
import styles from './review.module.css';

export function PlanDecision({planId,taskId}:{planId:string;taskId:string|null}) {
 const {systemId}=useSystemRoute();const api=useApiMode(),detail=usePlan(systemId,planId,api),{token}=useAdminToken(),qc=useQueryClient(),href=useKeepParams();
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const writeReason=!api?FIXTURE_REASON:!token?TOKEN_REASON:null;
 const run=(fn:()=>Promise<unknown>,o:{promote?:boolean}={})=>{setBusy(true);setError('');void fn().catch(e=>setError(planError('This decision',e))).finally(async()=>{await invalidatePlanDecision(qc,systemId,o.promote);setBusy(false);});};
 if(!api)return <p>{FIXTURE_REASON}</p>;
 if(detail.isLoading)return <p role="status">Loading plan…</p>;
 if(detail.error)return <p role="alert">{planError('Reading the plan',detail.error)}</p>;
 if(!detail.data)return <p role="alert">No plan {planId} on this System.</p>;
 const plan=detail.data;
 return <div className={styles.detailPane}><Link className={styles.action} to={href('work',{plan:planId,task:taskId,panel:null,evolution:null,realization:null})}>Open execution plan</Link>
 {taskId&&!plan.tasks.some(t=>t.id===taskId)?<p role="alert">No Task {taskId} in plan {planId}.</p>:taskId?<TaskReview key={taskId} plan={plan} taskId={taskId} writeReason={writeReason} busy={busy} run={run}/>:<PlanReview plan={plan} writeReason={writeReason} busy={busy} run={run}/>}
 {error&&<p role="alert" className={styles.error}>{error}</p>}</div>;
}
