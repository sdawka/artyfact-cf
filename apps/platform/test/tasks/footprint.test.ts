import { describe, expect, it } from 'vitest';
import { loadGenome } from '@artyfact/model';
import { metaTemplates } from '@artyfact/templates';
import { genomeFor } from '../fixtures/genome';
import { taskFootprint } from '../../worker/tasks/footprint';
const model=()=>loadGenome(genomeFor('system.footprint'),{templates:metaTemplates});
describe('artifact-bound read and write footprints',()=>{
 it('keeps partial write scope unknown when one accepted node has no mapping',()=>{
  const m=model();m.files={'screen.people':[{glob:'src/ui/**',declared:true}]};
  const f=taskFootprint(m,['screen.people','entity.ContactRecord'],['src/ui/page.ts'],'artifact.webapp','app');expect(f.globs).toEqual(['src/ui/**']);expect(f.known).toBe(false);expect(f.writeKnown).toBe(false);
 });
 it('includes read source paths independently and refuses mismatched repository identity',()=>{
  const m=model();m.files={'screen.people':[{glob:'src/ui/**',declared:true,repository:'app',artifact:'artifact.webapp'}],'entity.ContactRecord':[{glob:'src/data.ts',declared:true,repository:'app',artifact:'artifact.webapp'}]};
  const f=taskFootprint(m,['screen.people'],['src/ui/page.ts','src/data.ts'],'artifact.webapp','app',['entity.ContactRecord']);expect(f.paths).toEqual(['src/ui/page.ts']);expect(f.readPaths).toEqual(['src/data.ts']);expect(f.known).toBe(true);
  expect(taskFootprint(m,['screen.people'],[],'artifact.webapp','other').known).toBe(false);
 });
});
