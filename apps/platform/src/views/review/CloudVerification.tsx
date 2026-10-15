import type { VerificationResult } from '@artyfact/model';
import type { IntegratedBinding } from '../../../shared/lifecycle';
import { Button } from '@/components/ui';
import { lifecycleApi } from '@/api/lifecycle';
import styles from './review.module.css';
interface Props {systemId:string;planId:string;bindings:IntegratedBinding[];results:VerificationResult[];token:string;busy:boolean;writeReason:string|null;run(fn:()=>Promise<unknown>):void}
export function CloudVerification({systemId,planId,bindings,results,token,busy,writeReason,run}:Props){
 return <section className={styles.sub} aria-label="Cloud verification">
  <h3 className={styles.subTitle}>Cloud verification</h3>
  <p className={styles.reason}>Cloudflare tests the integrated source and records its output before approval. It does not deploy the candidate.</p>
  {bindings.map(binding=>{
   const result=results.find(r=>r.request.candidateId===binding.candidateId&&r.request.artifactId===binding.artifactId),failed=result?.status==='failed'||result?.status==='error',pending=result?.status==='queued'||result?.status==='running';
   const action=pending?'poll':'start';
   return <article key={binding.artifactId} aria-label={`Verification for ${binding.artifactId}`} className={styles.sub}>
    <h4 className={styles.label}>{binding.artifactId}: {result?.status??'not started'}</h4>
    <p><code>{binding.source.repo}@{binding.source.commit.slice(0,12)}</code></p>
    {result&&<p className={styles.reason}>Run <code>{result.request.id}</code> · model <code>{result.request.genome.commit.slice(0,12)}</code></p>}
    {result?.steps.length? <ul>{result.steps.map((step,i)=><li key={`${i}-${step.name}`}>{step.name}: {step.status}</li>)}</ul>:null}
    {result?.output&&<p className={styles.reason}>Verified output SHA-256: <code>{result.output.digest}</code></p>}
    {result&&<details className={styles.reason} style={{overflowWrap:'anywhere'}}>
     <summary>Verification evidence</summary>
     <p>Source: <code>{result.request.source.repo}@{result.request.source.commit}</code></p>
     <p>Model: <code>{result.request.genome.repo}@{result.request.genome.commit}:{result.request.genome.prefix||'/'}</code></p>
     <p>Model SHA-256: <code>{result.request.genome.digest}</code></p>
     {result.request.pinnedGenome&&<p>Checks authorized by: <code>{result.request.pinnedGenome.repo}@{result.request.pinnedGenome.commit}:{result.request.pinnedGenome.prefix||'/'}</code></p>}
     <ul>{result.steps.map((step,i)=><li key={i}><code style={{whiteSpace:'pre-wrap'}}>{step.command}</code> — {step.status}</li>)}</ul>
     {result.finishedAt&&<p>Finished: <time dateTime={result.finishedAt}>{result.finishedAt}</time></p>}
    </details>}
    {result?.error&&<p role="alert">{result.error}</p>}
    {result?.status!=='passed'&&<Button reason={writeReason??undefined} disabled={busy} onClick={()=>run(()=>lifecycleApi.verify(systemId,planId,action,{artifactId:binding.artifactId,...(failed&&{retry:true})},token))}>{pending?`Refresh ${binding.artifactId} verification`:failed?`Retry ${binding.artifactId} verification`:`Verify ${binding.artifactId} on Cloudflare`}</Button>}
   </article>;
  })}
 </section>;
}
