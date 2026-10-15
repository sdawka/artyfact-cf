import type { Evaluation } from '../shared/api';
import type { SystemModel, VerificationResult } from '@artyfact/model';
/** Only exact requested, executed hook commands replace the platform's not-run placeholders. */
export function cloudEvaluations(model:SystemModel,evaluations:Evaluation[],verification:VerificationResult|null):Evaluation[]{
 if(!verification||verification.status!=='passed')return evaluations;
 return evaluations.map(e=>{
  if(e.execution!=='not-run'||e.candidate!==verification.request.candidateId||e.targetRef!==verification.request.source.commit)return e;
  const hook=model.hooks.find(h=>h.id===e.hook),check=verification.checks?.find(c=>c.criterionId===e.criterion&&c.hookId===e.hook&&c.status==='passed');
  if(!hook||!check||hook.inputs.command!==check.command||!(hook.engine==='vitest'||hook.engine==='browser'&&hook.inputs.judgment!=='visual'))return e;
  return {...e,execution:'completed',verdict:'pass',verifier:'cloudflare-verification',startedAt:verification.startedAt??e.startedAt,finishedAt:verification.finishedAt,observations:[{command:check.command,runId:verification.request.id}],limitations:[],provenance:{...e.provenance,provider:'cloudflare-verification',runId:verification.request.id,sourceRepo:verification.request.source.repo,sourceCommit:verification.request.source.commit,genomeDigest:verification.request.genome.digest}};
 });
}
