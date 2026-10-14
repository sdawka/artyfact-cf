import { expect, it } from 'vitest';
import * as model from '../src/index';
const now=Date.parse('2026-10-14T12:00:00Z');
const expired={status:'working',leaseExpiresAt:'2026-10-14T11:00:00Z'};
const live={status:'working',leaseExpiresAt:'2026-10-14T13:00:00Z'};
type FixtureTask={id:string;status:string;dependsOn:string[];selectedCandidate:string|null;attempts:typeof expired[]};
const task=(status='pending',attempts:typeof expired[]=[]):FixtureTask=>( {id:'t',status,dependsOn:[],selectedCandidate:null as string|null,attempts:attempts.map(a=>({...a}))} );
const plan=(t=task()):{status:string;tasks:FixtureTask[];analysis:{conflicts:{tasks:string[]}[];waves:string[][]}}=>({status:'implementing',tasks:[t],analysis:{conflicts:[],waves:[['t']]}});
it('exports the pure recovery action',()=>{
 expect(model).toHaveProperty('taskAvailability');
 const p=plan(task('working',[expired]));
 expect(model.taskAvailability(p,p.tasks[0],now)).toBe('resume');
});
it.each(['pending','claimed','working'])('requires selected dependencies for %s tasks',status=>{
 const t={...task(status,status==='pending'?[]:[expired]),dependsOn:['dependency']};
 const p={...plan(t),tasks:[{...task(),id:'dependency'},t]};
 expect(model.taskAvailability(p,t,now)).toBeUndefined();
 p.tasks[0].selectedCandidate='candidate.dependency';
 expect(model.taskAvailability(p,t,now)).toBe(t.status==='pending'?'claim':'resume');
});
it.each(['submitted','selected','completed'])('does not offer %s even after expiration',status=>{
 const p=plan(task(status,[expired]));expect(model.taskAvailability(p,p.tasks[0],now)).toBeUndefined();
});
it('excludes promoted plans and any conflicting live writer',()=>{
 const t=task('working',[expired]);const p={...plan(t),status:'promoted'};
 expect(model.taskAvailability(p,t,now)).toBeUndefined();
 p.status='implementing';p.tasks.push({...task('working',[live]),id:'other'});
 p.analysis.conflicts.push({tasks:['t','other']});
 expect(model.taskAvailability(p,t,now)).toBeUndefined();
 p.tasks[1].attempts[0].leaseExpiresAt=expired.leaseExpiresAt;
 expect(model.taskAvailability(p,t,now)).toBe(t.status==='pending'?'claim':'resume');
});
it('never offers a pending task that still has a live writing attempt',()=>{
 const p=plan(task('pending',[live]));expect(model.taskAvailability(p,p.tasks[0],now)).toBeUndefined();
});
it('returns explicit actions at the lease boundary and for ended workspaces',()=>{
 const fresh=plan();expect(model.taskAvailability(fresh,fresh.tasks[0],now)).toBe('claim');
 for(const status of ['claimed','working']){
  const p=plan(task(status,[{...expired,leaseExpiresAt:new Date(now).toISOString()}]));
  expect(model.taskAvailability(p,p.tasks[0],now)).toBe('resume');
  p.tasks[0].attempts[0].leaseExpiresAt=new Date(now+1).toISOString();
  expect(model.taskAvailability(p,p.tasks[0],now)).toBeUndefined();
 }
 const ended=plan(task('pending',[{...live,status:'ended'}]));
 expect(model.taskAvailability(ended,ended.tasks[0],now)).toBe('resume');
});
it('blocks missing dependencies and any live participant in a conflict',()=>{
 const t={...task('working',[expired]),dependsOn:['missing']};const p=plan(t);
 expect(model.taskAvailability(p,t,now)).toBeUndefined();
 t.dependsOn=[];p.tasks.push({...task('working',[expired]),id:'other'}, {...task('working',[live]),id:'third'});
 p.analysis.conflicts.push({tasks:['t','other','third']});
 expect(model.taskAvailability(p,t,now)).toBeUndefined();
});
it.each(['claimed','working'])('does not treat an absent %s attempt as expired work',status=>{
 const p=plan(task(status));expect(model.taskAvailability(p,p.tasks[0],now)).toBeUndefined();
});
