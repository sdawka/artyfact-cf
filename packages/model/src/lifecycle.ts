/** Implementation work is pinned to an accepted Genome, independently of Genome Evolutions. */
export interface TaskFootprint { repo: string; artifactId: string; globs: string[]; paths: string[]; unmatched: string[]; known: boolean; readGlobs?:string[]; readPaths?:string[]; readUnmatched?:string[]; writeKnown?:boolean; readKnown?:boolean }
export interface TaskDefinition { id: string; title: string; artifactId: string; steps: string[]; dependsOn: string[]; readNodes: string[]; writeNodes: string[]; checks: string[]; footprint: TaskFootprint }
export interface TaskConflict { tasks: [string, string]; kind: 'dependency' | 'source' | 'ontology' | 'unknown'; subjects: string[]; message: string }
export interface TaskAnalysis { conflicts: TaskConflict[]; waves: string[][] }
export function validateTaskDefinitions(tasks: TaskDefinition[]): void {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (!t.id || ids.has(t.id)) throw new Error('task ids must be unique and nonempty');
    if (!t.artifactId || !t.steps.length || !t.writeNodes.length) throw new Error(`task ${t.id} requires artifact, steps and write scope`);
    if (t.footprint.artifactId !== t.artifactId || !t.footprint.repo) throw new Error(`task ${t.id} requires matching source identity`);
    ids.add(t.id);
  }
  const done = new Set<string>(), visiting = new Set<string>(), byId = new Map(tasks.map(t => [t.id, t]));
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('task dependency cycle');
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)!.dependsOn) { if (!ids.has(dep)) throw new Error(`unknown dependency ${dep}`); visit(dep); }
    visiting.delete(id); done.add(id);
  };
  tasks.forEach(t => visit(t.id));
}
const intersection = (a: string[], b: string[]) => a.filter(x => b.includes(x));
const prefix = (g: string) => { const i = g.search(/[*?[\]{}()!+@]/); return i < 0 ? g : g.slice(0, i).replace(/[^/]*$/, ''); };
export function analyzeTasks(tasks: TaskDefinition[]): TaskAnalysis {
  validateTaskDefinitions(tasks);
  const sorted = [...tasks].sort((a,b) => a.id.localeCompare(b.id)), conflicts: TaskConflict[] = [];
  for (let i=0;i<sorted.length;i++) for (let j=i+1;j<sorted.length;j++) {
    const a=sorted[i], b=sorted[j]; let kind: TaskConflict['kind'] | undefined, subjects: string[] = [];
    if (a.dependsOn.includes(b.id) || b.dependsOn.includes(a.id)) kind='dependency';
    else if (!a.footprint.known || !b.footprint.known) kind='unknown';
    else {
      subjects = [...intersection(a.writeNodes, [...b.writeNodes, ...b.readNodes]), ...intersection(b.writeNodes, a.readNodes)];
      if (subjects.length) kind='ontology';
      else if (a.footprint.repo === b.footprint.repo) {
        subjects = [...intersection(a.footprint.paths,[...b.footprint.paths,...(b.footprint.readPaths??[])]),...intersection(b.footprint.paths,a.footprint.readPaths??[])];
        const overlaps=(xs:string[],ys:string[])=>xs.some(x=>ys.some(y=>prefix(x).startsWith(prefix(y))||prefix(y).startsWith(prefix(x))));
        const mayOverlap = overlaps(a.footprint.globs,[...b.footprint.globs,...(b.footprint.readGlobs??[])])||overlaps(b.footprint.globs,a.footprint.readGlobs??[]);
        if (subjects.length || mayOverlap) kind='source';
      }
    }
    if (kind) conflicts.push({ tasks:[a.id,b.id], kind, subjects:[...new Set(subjects)].sort(), message:`${a.id} and ${b.id}: ${kind} interference` });
  }
  const waves:string[][]=[], assigned=new Map<string,number>();
  while (assigned.size<tasks.length) for (const t of sorted) {
    if (assigned.has(t.id) || t.dependsOn.some(d=>!assigned.has(d))) continue;
    let wave=Math.max(0,...t.dependsOn.map(d=>assigned.get(d)!+1));
    while (waves[wave]?.some(id=>conflicts.some(c=>c.tasks.includes(id)&&c.tasks.includes(t.id)))) wave++;
    (waves[wave]??=[]).push(t.id); assigned.set(t.id,wave);
  }
  return { conflicts, waves };
}
