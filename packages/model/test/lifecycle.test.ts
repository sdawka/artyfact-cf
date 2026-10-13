import { describe, expect, it } from 'vitest';
import { analyzeTasks, validateTaskDefinitions } from '../src/lifecycle';
const task = (id: string, write: string[], read: string[] = []) => ({ id, title: id, artifactId: 'web', steps: ['implement'], dependsOn: [] as string[], readNodes: read, writeNodes: write, checks: [], footprint: { repo: 'web', artifactId: 'web', globs: [id + '/**'], paths: [id + '/file.ts'], unmatched: [], known: true } });
describe('realization task scheduling', () => {
  it('allows read/read sharing but serializes a reader against a writer', () => {
    expect(analyzeTasks([task('a', ['A'], ['shared']), task('b', ['B'], ['shared'])]).waves).toEqual([['a', 'b']]);
    expect(analyzeTasks([task('a', ['shared']), task('b', ['B'], ['shared'])]).waves).toEqual([['a'], ['b']]);
  });
  it('does not call unknown source scope independent', () => {
    const a = task('a', ['A']); a.footprint.known = false;
    expect(analyzeTasks([a, task('b', ['B'])]).conflicts[0].kind).toBe('unknown');
  });
  it('keeps identical paths in different repositories independent', () => {
    const a = task('a', ['A']), b = task('b', ['B']); b.artifactId = 'mobile'; b.footprint.repo = 'mobile'; b.footprint.artifactId = 'mobile'; b.footprint.paths = a.footprint.paths; b.footprint.globs = a.footprint.globs;
    expect(analyzeTasks([a, b]).waves).toEqual([['a', 'b']]);
  });
  it('rejects cycles and missing dependencies', () => {
    const a = task('a', ['A']), b = task('b', ['B']); a.dependsOn.push('b'); b.dependsOn.push('a');
    expect(() => validateTaskDefinitions([a, b])).toThrow(/cycle/);
    expect(() => validateTaskDefinitions([{...a, dependsOn: ['missing']}])).toThrow(/unknown dependency/);
  });
  it('compares write source paths against read scope from different ontology nodes',()=>{
    const a=task('a',['A']),b=task('b',['B'],['C']);
    const withRead={...b,footprint:{...b.footprint,readGlobs:['a/**'],readPaths:['a/file.ts']}};
    expect(analyzeTasks([a,withRead]).conflicts[0].kind).toBe('source');
  });

});
