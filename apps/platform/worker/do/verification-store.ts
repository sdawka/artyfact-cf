import { canonicalJson, normalizeVerificationRequest, VERIFICATION_OUTPUT_MAX_BYTES, verificationLogKey, verificationOutputKey, type VerificationRequest, type VerificationResult } from '@artyfact/model';
import type { RealizationPlan } from '../../shared/lifecycle';

/** Canonical comparison also fences a response whose check list or model identity changed. */
export function sameVerification(a:unknown,b:unknown):boolean {
 return canonicalJson(a)===canonicalJson(b);
}
export const needsCloudVerification=(p:RealizationPlan)=>p.systemId==='system.artyfact';
const fail=(message:string):never=>{throw new Error(`[verification-required] ${message}`);};
export class VerificationStore {
 constructor(private sql:SqlStorage){}
 get(pid:string,artifactId:string):VerificationResult|null {
  const row=this.sql.exec('SELECT result_json FROM plan_verifications WHERE plan_id=? AND artifact_id=?',pid,artifactId).toArray()[0];
  return row?JSON.parse(String(row.result_json)) as VerificationResult:null;
 }
 list(pid:string):VerificationResult[]{return this.sql.exec('SELECT result_json FROM plan_verifications WHERE plan_id=? ORDER BY artifact_id',pid).toArray().map(r=>JSON.parse(String(r.result_json)) as VerificationResult);}
 assertIdentity(p:RealizationPlan,r:VerificationRequest):void {
  const b=p.integration.find(b=>b.artifactId===r.artifactId);
  if(r.systemId!==p.systemId||r.planId!==p.id||!b||b.candidateId!==r.candidateId)fail('verification candidate identity changed');
  if(!sameVerification(b!.source,r.source))fail('verification source changed');
  const model=b!.model?b!.source:p.genome;
  if(model.repo!==r.genome.repo||model.commit!==r.genome.commit)fail('verification model changed');
  const pinned=r.pinnedGenome??r.genome;
  if(pinned.repo!==p.genome.repo||pinned.commit!==p.genome.commit)fail('verification pinned model changed');
 }
 reserve(p:RealizationPlan,request:VerificationRequest,retry=false):VerificationResult {
  request=normalizeVerificationRequest(request);
  if(p.status!=='integrated')fail('verification requires an integrated plan');
  this.assertIdentity(p,request);
  const existing=this.get(p.id,request.artifactId);
  if(existing) {
   if(sameVerification(existing.request,request))return existing;
   if(existing.status==='passed')fail('passed verification is immutable');
   if(!retry||!['failed','error'].includes(existing.status))fail('verification already in progress; refresh its result');
   if(existing.request.id===request.id)fail('retry requires a new verification id');
  }
  const result:VerificationResult={version:1,request:normalizeVerificationRequest(request),status:'queued',steps:[]};
  this.sql.exec('INSERT INTO plan_verifications(plan_id,artifact_id,result_json) VALUES(?,?,?) ON CONFLICT(plan_id,artifact_id) DO UPDATE SET result_json=excluded.result_json',p.id,request.artifactId,JSON.stringify(result));
  return result;
 }
 record(p:RealizationPlan,result:VerificationResult):VerificationResult {
  this.assertIdentity(p,result.request);
  const previous=this.get(p.id,result.request.artifactId);
  if(!previous||!sameVerification(previous.request,result.request))fail('verification result identity differs from the reserved run');
  if(['passed','failed','error'].includes(previous!.status)) {
   if(sameVerification(previous,result))return previous!;
   fail('terminal verification cannot change');
  }
  const o=result.output;
  if(o&&(o.key!==verificationOutputKey(result.request.id)||typeof o.digest!=='string'||!/^[0-9a-f]{64}$/.test(o.digest)||!Number.isSafeInteger(o.size)||o.size<1||o.size>VERIFICATION_OUTPUT_MAX_BYTES))fail('verification output must be the run\'s own bounded, digest-bound archive');
  if(result.logKey!==undefined&&result.logKey!==verificationLogKey(result.request.id))fail('verification log must be the run\'s own gate log');
  if(result.status==='passed'&&(!result.output||!result.finishedAt||!result.steps.length||result.steps.some(s=>s.status!=='passed')))fail('passed verification lacks successful steps and output');
  this.sql.exec('UPDATE plan_verifications SET result_json=? WHERE plan_id=? AND artifact_id=?',JSON.stringify(result),p.id,result.request.artifactId);
  return result;
 }
 assertPassed(p:RealizationPlan):VerificationResult[] {
  return p.integration.map(b=>{
   const result=this.get(p.id,b.artifactId);if(!result)fail(`Cloud verification is required for ${b.artifactId}`);
   this.assertIdentity(p,result!.request);
   if(result!.status!=='passed'||!result!.output)fail(`Cloud verification for ${b.artifactId} is ${result!.status}`);
   return result!;
  });
 }
}
