import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CloudVerification } from './CloudVerification';
import { lifecycleApi } from '@/api/lifecycle';
it('starts the exact binding and offers refresh for a running verification',()=>{
 const verify=vi.spyOn(lifecycleApi,'verify').mockResolvedValue({} as never);
 const common={systemId:'system.artyfact',planId:'plan',bindings:[{artifactId:'app',candidateId:'candidate',source:{repo:'fork',commit:'a'.repeat(40)},taskCandidates:[],realizedGenome:'b'.repeat(40)}],token:'admin',busy:false,writeReason:null,run:(fn:()=>Promise<unknown>)=>{void fn();}};
 const view=render(<CloudVerification {...common} results={[]} />);
 fireEvent.click(screen.getByRole('button',{name:'Verify app on Cloudflare'}));
 expect(verify).toHaveBeenCalledWith('system.artyfact','plan','start',{artifactId:'app'},'admin');
 view.rerender(<CloudVerification {...common} results={[{version:1,request:{version:1,id:'verify-one',systemId:'system.artyfact',planId:'plan',candidateId:'candidate',artifactId:'app',source:common.bindings[0].source,genome:{repo:'model',commit:'b'.repeat(40),prefix:'',digest:'c'.repeat(64)},profile:'artyfact-self-v1',checks:[]},status:'running',steps:[]}]} />);
 fireEvent.click(screen.getByRole('button',{name:'Refresh app verification'}));expect(verify).toHaveBeenLastCalledWith('system.artyfact','plan','poll',{artifactId:'app'},'admin');
 verify.mockRestore();
});
