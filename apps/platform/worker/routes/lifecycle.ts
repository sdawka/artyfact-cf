import { startVerification, pollVerification, activationDescriptor, verificationOutput } from '../verification';
import { Hono } from 'hono';
import { requireAdmin, requireRealizationSecret } from '../auth';
import { checkpointLifecycleTask, createRealizationPlan, integrateLifecyclePlan, promoteLifecyclePlan, reviewLifecycleFile, reviewLifecyclePlan, selectLifecycleTask, startLifecycleTask, submitLifecycleTask } from '../lifecycle-service';
import { reviewLifecycleTask, reviewLifecycleTaskFile } from '../lifecycle-task-review';
import { systemStub } from '../service';
import { draftRealizationPlan } from '../tasks/planner';
import { rpc as call } from '../errors';
import { body, origin, type AppEnv, type Ctx } from './app';
import { requireImportReviewed as reviewed } from './import-review';
import { MAX_SUBMIT_BODY } from '../evidence';
const prefix='/systems/:id/realization-plans';
const plan=`${prefix}/:pid`,task=`${plan}/tasks/:tid`;
const ids=(c:Ctx)=>[c.req.param('id')!,c.req.param('pid')!,c.req.param('tid')!] as const;
async function authed(c:Ctx) {const [sid,pid,tid]=ids(c);await requireRealizationSecret(c.env,c.req.header('authorization'),async()=>{try{const p=await systemStub(c.env,sid).realizationPlan(pid),t=p.tasks.find(t=>t.id===tid),a=t?.attempts.at(-1);return [{systemId:sid,hash:a?await systemStub(c.env,sid).realizationSecretHash(a.realizationId):null}];}catch{return [];}});}
// Reads follow the System's visibility like /work (public); every write is admin or realization-secret only.
export const lifecycle=new Hono<AppEnv>()
 .get(prefix,async c=>c.json({plans:await systemStub(c.env,c.req.param('id')).realizationPlans()}))
 .post(prefix,requireAdmin,reviewed,async c=>c.json(await createRealizationPlan(c.env,c.req.param('id'),await body(c)),201))
 // Draft: persists nothing; its `request` posts unchanged to create.
 .post(`${prefix}/draft`,requireAdmin,reviewed,async c=>c.json(await draftRealizationPlan(c.env,c.req.param('id'),await body(c))))
 .get(plan,async c=>c.json(await call(systemStub(c.env,c.req.param('id')).realizationPlan(c.req.param('pid')))))
 .get(`${plan}/review`,async c=>c.json(await reviewLifecyclePlan(c.env,c.req.param('id'),c.req.param('pid'))))
 .get(`${plan}/review/files`,async c=>c.json(await reviewLifecycleFile(c.env,c.req.param('id'),c.req.param('pid'),c.req.query('artifactId')??'',c.req.query('path')??'')))
 .post(`${plan}/integrate`,requireAdmin,reviewed,async c=>c.json(await integrateLifecyclePlan(c.env,c.req.param('id'),c.req.param('pid'),origin(c))))
 .post(`${plan}/promote`,requireAdmin,reviewed,async c=>c.json(await promoteLifecyclePlan(c.env,c.req.param('id'),c.req.param('pid'),await body(c))))
 .post(`${plan}/verification/start`,requireAdmin,reviewed,async c=>c.json(await startVerification(c.env,c.req.param('id'),c.req.param('pid'),await body(c))))
 .post(`${plan}/verification/poll`,requireAdmin,reviewed,async c=>c.json(await pollVerification(c.env,c.req.param('id'),c.req.param('pid'),await body(c))))
 .get(`${plan}/activation`,requireAdmin,async c=>c.json(await activationDescriptor(c.env,c.req.param('id'),c.req.param('pid'),c.req.query('artifactId')??'')))
 .get(`${plan}/verification/output`,requireAdmin,async c=>verificationOutput(c.env,c.req.param('id'),c.req.param('pid'),c.req.query('artifactId')??''))
 .get(`${task}/review`,async c=>c.json(await reviewLifecycleTask(c.env,...ids(c))))
 .get(`${task}/review/files`,async c=>c.json(await reviewLifecycleTaskFile(c.env,...ids(c),c.req.query('candidateId')??'',c.req.query('path')??'')))
 .post(`${task}/checkpoint`,async c=>{await authed(c);return c.json(await checkpointLifecycleTask(c.env,...ids(c),await body(c)));})
 // Submit carries up to four screenshots: its body is capped server side (413) before it is parsed.
 .post(`${task}/submit`,async c=>{await authed(c);return c.json(await submitLifecycleTask(c.env,...ids(c),await body(c,MAX_SUBMIT_BODY)),201);})
 .post(`${task}/select`,requireAdmin,reviewed,async c=>c.json(await selectLifecycleTask(c.env,...ids(c),await body(c))));
lifecycle.get(task,async c=>{await authed(c);const [sid,pid,tid]=ids(c),p=await call(systemStub(c.env,sid).realizationPlan(pid));return c.json({task:p.tasks.find(t=>t.id===tid)!,planId:pid,genome:p.genome});});
for(const action of ['claim','start','resume'])lifecycle.post(`${task}/${action}`,requireAdmin,reviewed,async c=>c.json(await startLifecycleTask(c.env,...ids(c),await body(c),origin(c),action==='resume'),201));
