import { normalizeVerificationRequest, verificationLogKey, VERIFICATION_RESULT_MAX_BYTES, verificationResultSchema as resultSchema, verificationModelDigest, VERIFICATION_MODEL_MAX_FILES, type VerificationRequest, type VerificationResult } from '@artyfact/model';
import { z } from 'zod';
import { artifactsFor, withRepo } from './artifacts/client';
import { genomePrefix, readGenomeSourceFiles } from './artifacts/genome-source';
import { badRequest, conflict, HttpError, notFound, rpc } from './errors';
import { genomeAt, systemStub } from './service';
import { gateCriteria, hooksOf } from './promotion';
import { sameVerification } from './do/verification-store';
import { refreshLifecycleCandidate } from './lifecycle-service';

const inputSchema=z.object({artifactId:z.string().min(1).max(200),retry:z.boolean().optional()}).strict();
function input(body:unknown){const r=inputSchema.safeParse(body);if(!r.success)throw badRequest('artifactId and optional retry are required');return r.data;}
function verifier(env:Env){
 if(!env.VERIFICATION_URL||!env.VERIFICATION_TOKEN)throw new HttpError(503,'verification-unconfigured','Configure the Cloudflare verifier URL and server token on the local operator.');
 const url=new URL(env.VERIFICATION_URL);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new HttpError(503,'verification-unconfigured','The configured verifier must use HTTPS without embedded credentials.');
 return {base:url.href.replace(/\/$/,''),token:env.VERIFICATION_TOKEN};
}
// workerd accepts only 'follow' | 'manual': a 3xx is not ok and is refused below, never followed.
// Starting authorizes against the Genome before CI creates the run, so it gets longer than polls.
async function remote(env:Env,path:string,method:string,transport:typeof fetch,body?:unknown):Promise<Response>{
 const c=verifier(env);const response=await transport(`${c.base}${path}`,{method,redirect:'manual',signal:AbortSignal.timeout(method==='POST'?120_000:30_000),headers:{authorization:`Bearer ${c.token}`,...(body!==undefined&&{'content-type':'application/json'})},...(body!==undefined&&{body:JSON.stringify(body)})});
 if(!response.ok){await response.body?.cancel();throw new HttpError(502,'verification-unavailable',`Cloud verifier returned HTTP ${response.status}; the recorded run can be retried or polled.`);}
 return response;
}
async function resultBody(response:Response,request:VerificationRequest):Promise<VerificationResult>{
 const reader=response.body?.getReader();if(!reader)throw conflict('verification-invalid','Cloud verifier returned no evidence');
 let text='',size=0;const decoder=new TextDecoder();
 try{for(;;){const n=await reader.read();if(n.done)break;size+=n.value.byteLength;if(size>VERIFICATION_RESULT_MAX_BYTES)throw conflict('verification-invalid','Cloud evidence exceeds its limit');text+=decoder.decode(n.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
 let parsed:z.infer<typeof resultSchema>;
 try{parsed=resultSchema.parse(JSON.parse(text));}catch{throw conflict('verification-invalid','Cloud verifier returned invalid evidence');}
 const normalized=normalizeVerificationRequest(parsed.request);
 if(!sameVerification(normalized,normalizeVerificationRequest(request)))throw conflict('verification-required','Cloud verification result identity differs from the requested run');
 if(parsed.logKey!==undefined&&parsed.logKey!==verificationLogKey(normalized.id))throw conflict('verification-invalid','Cloud verification names another run\'s gate log');
 if(parsed.status==='passed') {
  if(!parsed.output||!parsed.finishedAt||!parsed.steps.length||parsed.steps.some(s=>s.status!=='passed'))throw conflict('verification-invalid','Cloud verification lacks successful steps and immutable output');
  const expected=normalized.checks;
  if((parsed.checks??[]).length!==expected.length||expected.some(c=>!(parsed.checks??[]).some(x=>sameVerification(c,{criterionId:x.criterionId,hookId:x.hookId,command:x.command})&&x.status==='passed')))throw conflict('verification-invalid','Cloud verification lacks exact criterion evidence');
 }
 return {...parsed,request:normalized};
}
async function modelRef(env:Env,ref:{repo:string;commit:string}){
 return withRepo(artifactsFor(env),ref.repo,async repo=>{
  const files=await readGenomeSourceFiles(repo,ref.commit);
  if(files.size>VERIFICATION_MODEL_MAX_FILES)throw conflict('verification-invalid','The accepted model exceeds the cloud verification file limit.');
  return {...ref,prefix:await genomePrefix(repo,ref.commit),digest:verificationModelDigest(files)};
 });
}
/** A retry also repairs evidence refresh interrupted after the immutable result was stored. */
async function refreshPassed(env:Env,sid:string,result:VerificationResult):Promise<VerificationResult>{
 if(result.status==='passed') {
  const stub=systemStub(env,sid),plan=await stub.realizationPlan(result.request.planId);
  if(plan.status==='integrated') {
   const candidate=await stub.candidate(result.request.candidateId);
   if(candidate)await refreshLifecycleCandidate(env,sid,candidate.realization,candidate.commit);
  }
 }
 return result;
}
export async function startVerification(env:Env,sid:string,pid:string,body:unknown,transport:typeof fetch=fetch):Promise<VerificationResult>{
 verifier(env);const {artifactId,retry}=input(body),stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid));
 if(p.status!=='integrated')throw conflict('invalid-state','Integrate the plan before cloud verification.');
 const b=p.integration.find(x=>x.artifactId===artifactId);if(!b)throw notFound('integrated source binding missing');
 const state=await stub.state();if(state?.genomeCommit!==p.genome.commit||state.genomeSource!==p.genome.repo)throw conflict('stale-base','The accepted model changed; replan before cloud verification.');
 let existing=await stub.verification(pid,artifactId);
 if(existing&&!(retry&&['failed','error'].includes(existing.status))) {
  if(existing.status==='passed')return refreshPassed(env,sid,existing);
 } else {
  const pinnedGenome=await modelRef(env,p.genome),genome=b.model?await modelRef(env,b.source):pinnedGenome;
  const g=await genomeAt(env,sid,p.genome.commit,p.genome.repo),checks=[...new Set(p.tasks.filter(t=>t.artifactId===artifactId).flatMap(t=>t.checks))];
  const criteria=gateCriteria(g.model,{acceptanceCriteria:checks},{target:'app'});
  const requested=criteria.flatMap(c=>{const criterion=g.model.criteria.find(x=>x.id===c.id);return criterion?hooksOf(g.model,criterion).filter(h=>(h.engine==='vitest'||h.engine==='browser'&&h.inputs.judgment!=='visual')&&!!h.inputs.command).map(h=>({criterionId:c.id,hookId:h.id,command:h.inputs.command!})):[];});
  const request=normalizeVerificationRequest({version:1,id:`verify-${crypto.randomUUID()}`,systemId:sid,planId:pid,candidateId:b.candidateId,artifactId,source:b.source,genome,pinnedGenome,profile:'artyfact-self-v1',checks:requested});
  existing=await rpc(stub.reserveVerification(request,!!retry));
 }
 const response=await remote(env,'/verify','POST',transport,existing.request),result=await resultBody(response,existing.request);
 return refreshPassed(env,sid,await rpc(stub.recordVerification(result)));
}
export async function pollVerification(env:Env,sid:string,pid:string,body:unknown,transport:typeof fetch=fetch):Promise<VerificationResult>{
 const {artifactId}=input(body),stub=systemStub(env,sid),previous=await stub.verification(pid,artifactId);if(!previous)throw notFound('Start cloud verification before polling.');
 if(['passed','failed','error'].includes(previous.status))return refreshPassed(env,sid,previous);
 const result=await resultBody(await remote(env,`/verify/${encodeURIComponent(previous.request.id)}`,'GET',transport),previous.request);
 return refreshPassed(env,sid,await rpc(stub.recordVerification(result)));
}
/** Every activation is tied to the current promoted System manifest; old approvals cannot launch a later head. */
export async function activationDescriptor(env:Env,sid:string,pid:string,artifactId:string){
 const stub=systemStub(env,sid),p=await rpc(stub.realizationPlan(pid)),state=await stub.state();
 if(p.status!=='promoted'||!state?.head)throw conflict('activation-unapproved','Approve the verified implementation in Artyfact before activating it.');
 const binding=p.integration.find(b=>b.artifactId===artifactId),current=state.manifest?.artifacts[artifactId];
 if(!binding||!current||current.realizationPlan!==pid||current.repo!==binding.source.repo||current.commit!==binding.source.commit)throw conflict('stale-base','This approval is no longer the current source.');
 const results=await rpc(stub.assertPlanVerified(pid)),verification=results.find(v=>v.request.artifactId===artifactId)!;
 if(state.genomeSource!==verification.request.genome.repo||state.genomeCommit!==verification.request.genome.commit)throw conflict('stale-base','The accepted model changed after verification.');
 return {systemId:sid,planId:pid,systemCommit:state.head,source:binding.source,genome:verification.request.genome,verification};
}
export async function verificationOutput(env:Env,sid:string,pid:string,artifactId:string,transport:typeof fetch=fetch):Promise<Response>{
 const {verification}=await activationDescriptor(env,sid,pid,artifactId);
 const response=await remote(env,`/verify/${encodeURIComponent(verification.request.id)}/output`,'GET',transport);
 return new Response(response.body,{headers:{'content-type':'application/gzip','cache-control':'no-store','x-content-sha256':verification.output!.digest}});
}
