import { Hono } from 'hono';
import { requireAdmin, requireRealizationSecret } from '../auth';
import { checkpointLifecycleTask, createRealizationPlan, integrateLifecyclePlan, promoteLifecyclePlan, reviewLifecycleFile, reviewLifecyclePlan, selectLifecycleTask, startLifecycleTask, submitLifecycleTask } from '../lifecycle-service';
import { systemStub } from '../service';
import { fromRpc } from '../errors';
import { body, origin, type AppEnv, type Ctx } from './app';
const prefix='/systems/:id/realization-plans';
const plan=`${prefix}/:pid`,task=`${plan}/tasks/:tid`;
async function call<T>(p:Promise<T>) {try{return await p;}catch(e){throw fromRpc(e)??e;}}
const ids=(c:Ctx)=>[c.req.param('id')!,c.req.param('pid')!,c.req.param('tid')!] as const;
async function authed(c:Ctx) {const [sid,pid,tid]=ids(c);await requireRealizationSecret(c.env,c.req.header('authorization'),async()=>{try{const p=await systemStub(c.env,sid).realizationPlan(pid),t=p.tasks.find(t=>t.id===tid),a=t?.attempts.at(-1);return [{systemId:sid,hash:a?await systemStub(c.env,sid).realizationSecretHash(a.realizationId):null}];}catch{return [];}});}
export const lifecycle=new Hono<AppEnv>()
 .get(prefix,requireAdmin,async c=>c.json({plans:await systemStub(c.env,c.req.param('id')).realizationPlans()}))
 .post(prefix,requireAdmin,async c=>c.json(await createRealizationPlan(c.env,c.req.param('id'),await body(c)),201))
 .get(plan,requireAdmin,async c=>c.json(await call(systemStub(c.env,c.req.param('id')).realizationPlan(c.req.param('pid')))))
 .get(`${plan}/review`,requireAdmin,async c=>c.json(await reviewLifecyclePlan(c.env,c.req.param('id'),c.req.param('pid'))))
 .get(`${plan}/review/files`,requireAdmin,async c=>c.json(await reviewLifecycleFile(c.env,c.req.param('id'),c.req.param('pid'),c.req.query('artifactId')??'',c.req.query('path')??'')))
 .post(`${plan}/integrate`,requireAdmin,async c=>c.json(await integrateLifecyclePlan(c.env,c.req.param('id'),c.req.param('pid'),origin(c))))
 .post(`${plan}/promote`,requireAdmin,async c=>c.json(await promoteLifecyclePlan(c.env,c.req.param('id'),c.req.param('pid'),await body(c))))
 .post(`${task}/checkpoint`,async c=>{await authed(c);return c.json(await checkpointLifecycleTask(c.env,...ids(c),await body(c)));})
 .post(`${task}/submit`,async c=>{await authed(c);return c.json(await submitLifecycleTask(c.env,...ids(c),await body(c)),201);})
 .post(`${task}/select`,requireAdmin,async c=>c.json(await selectLifecycleTask(c.env,...ids(c),await body(c))));
lifecycle.get(task,async c=>{await authed(c);const [sid,pid,tid]=ids(c),p=await call(systemStub(c.env,sid).realizationPlan(pid));return c.json({task:p.tasks.find(t=>t.id===tid)!,planId:pid,genome:p.genome});});
for(const action of ['claim','start','resume'])lifecycle.post(`${task}/${action}`,requireAdmin,async c=>c.json(await startLifecycleTask(c.env,...ids(c),await body(c),origin(c),action==='resume'),201));
