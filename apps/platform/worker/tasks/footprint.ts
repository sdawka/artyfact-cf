import type { SystemModel, TaskFootprint } from '@artyfact/model';
import { globMatch } from '../artifacts/source-map';
/** Source identity is part of scope. Inherited ancestor mappings remain conservative. */
export function taskFootprint(model:SystemModel,nodes:string[],tree:string[],artifactId:string,repo:string,readNodes:string[]=[]):TaskFootprint {
 const forNodes=(nodes:string[])=> {
 const inherited=new Set(nodes.flatMap(id=>model.index.path(id).filter(p=>{const e=model.index.byId[p];return e?.type!=='system'&&e?.type!=='thing';})).concat(nodes));
 const entries=[...inherited].flatMap(id=>model.files[id]??[]).filter(g=>(!g.artifact||g.artifact===artifactId)&&(!g.bindingId||g.bindingId===artifactId)&&(!g.repository||g.repository===repo));
 return entries;};
 const entries=forNodes(nodes),reads=forNodes(readNodes);
 const globs=[...new Set(entries.map(g=>g.glob))].sort(),paths=[...new Set(tree.filter(p=>globs.some(g=>globMatch(g,p))))].sort();
 return {repo,artifactId,globs,paths,unmatched:globs.filter(g=>!tree.some(p=>globMatch(g,p))),known:nodes.every(id=>forNodes([id]).length>0)&&readNodes.every(id=>forNodes([id]).length>0),writeKnown:nodes.every(id=>forNodes([id]).length>0),readKnown:readNodes.every(id=>forNodes([id]).length>0),readGlobs:[...new Set(reads.map(g=>g.glob))].sort(),readPaths:tree.filter(p=>reads.some(g=>globMatch(g.glob,p))).sort(),readUnmatched:reads.filter(g=>!tree.some(p=>globMatch(g.glob,p))).map(g=>g.glob)};
}
