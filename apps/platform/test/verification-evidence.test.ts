import { expect,it } from 'vitest';
import type { VerificationResult } from '@artyfact/model';
import { buildGenome } from '../worker/artifacts/genome-source';
import { cloudEvaluations } from '../worker/verification-evidence';
import type { Evaluation } from '../shared/api';
const commit='a'.repeat(40);
it('uses exact executed command evidence only, leaving unknown or failed hooks blocked',()=>{
 const model=buildGenome(new Map([['node.yaml','id: system.self\nkind: system\ncriteria:\n  - id: C.test\n    title: Tests\n    claim: Tests pass\n    hooks:\n      - id: hook.test\n        assay: test\n        tier: execution\n        triggers: [submission]\n        engine: vitest\n        inputs:\n          command: npm test\n']]),commit).model;
 const e:Evaluation={id:'e',candidate:'candidate',criterion:'C.test',hook:'hook.test',ownerId:'system.self',subjectId:'system.self',targetRef:commit,execution:'not-run',verdict:'unknown',verifier:'platform',startedAt:'2026-10-14T00:00:00Z',observations:[],limitations:[],provenance:{}};
 const result:VerificationResult={version:1,request:{version:1,id:'run',systemId:'system.self',planId:'plan',artifactId:'app',candidateId:'candidate',source:{repo:'app',commit},genome:{repo:'model',commit,prefix:'',digest:'b'.repeat(64)},profile:'artyfact-self-v1',checks:[{criterionId:'C.test',hookId:'hook.test',command:'npm test'}]},status:'passed',steps:[],checks:[{criterionId:'C.test',hookId:'hook.test',command:'npm test',status:'passed'}],finishedAt:'2026-10-14T00:01:00Z'};
 expect(cloudEvaluations(model,[e],result)[0]).toMatchObject({execution:'completed',verdict:'pass',verifier:'cloudflare-verification',targetRef:commit});
 expect(cloudEvaluations(model,[e],{...result,status:'failed'})[0]).toEqual(e);
 expect(cloudEvaluations(model,[e],{...result,checks:[]})[0]).toEqual(e);
 expect(cloudEvaluations(model,[{...e,targetRef:'b'.repeat(40)}],result)[0].verdict).toBe('unknown');
 expect(cloudEvaluations(model,[e],{...result,checks:[{...result.checks![0],command:'echo passed'}]})[0]).toEqual(e);
 expect(cloudEvaluations(model,[{...e,execution:'error'}],result)[0].execution).toBe('error');
});
