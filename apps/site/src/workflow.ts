import type { SystemModel } from '@artyfact/model';

/** Who acts in a step, in the site's words. The Genome says user, external or system; a system step whose operation runs in the ci Thing is CI. */
export type Actor = 'person' | 'agent' | 'platform' | 'ci';
export type ModelRef = { id: string; kind: string; name: string; detail?: string };
export type WorkflowStep = {
  /** The step's graph id, `J.lifecycle/<step>`. */
  id: string;
  actor: Actor;
  action: string;
  commands: ModelRef[];
  screens: ModelRef[];
  endpoints: ModelRef[];
  runtime: ModelRef[];
  modules: ModelRef[];
  journeys: ModelRef[];
  guardrails: ModelRef[];
};
export type WorkflowPhase = {
  id: string;
  index: number;
  name: string;
  steps: WorkflowStep[];
  actors: Actor[];
  /** Every Task runs this phase side by side, in its own fork. */
  parallel: boolean;
  /** Every model node id the phase shows, deduplicated, steps first. */
  nodeIds: string[];
};
export type Workflow = {
  journey: { id: string; name: string; goal: string };
  phases: WorkflowPhase[];
  /** The step edge labels where the work fans out to Tasks and joins again. */
  fanOut: string;
  join: string;
  /** The edge from the last phase back to an earlier one. */
  loop: { to: string; when: string } | null;
};

const actors: Record<string, Actor> = { user: 'person', external: 'agent', system: 'platform' };
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * The How it works workflow, read from a loaded Genome: the journey's segments are the ordered phases, its steps say
 * who acts and what happens, their links name the commands, screens, endpoints and CI Workflow they use, modules
 * come from `implements` links on those endpoints and Workflows (the router, which implements every route, is left
 * out), and commitments that `govern` a step are its guardrails. The edge
 * labelled `for each …` fans out to parallel Tasks and the edge labelled `once every …` joins them.
 * Throws when the journey or its phases are missing, so the build fails instead of drawing an empty diagram.
 */
export function deriveWorkflow(model: SystemModel, journeyId = 'J.lifecycle'): Workflow {
  const journey = model.journeys.find(j => j.id === journeyId);
  if (!journey?.segments?.length) throw new Error(journeyId + ' has no phases (segments) in the Genome');
  const { nodes, links } = model.graph;
  const byId = new Map(nodes.map(n => [n.id, n]));
  const text = (value: unknown) => typeof value === 'string' ? value : undefined;
  const nameOf = (id: string) => { const f = byId.get(id)?.fields ?? {}; return text(f.name) ?? text(f.statement) ?? text(f.title) ?? id; };
  const within = (id: string, ancestor: string) => { for (let n = byId.get(id); n; n = n.parent ? byId.get(n.parent) : undefined) if (n.id === ancestor) return true; return false; };
  const ref = (id: string, detail?: unknown): ModelRef => {
    const node = byId.get(id);
    if (!node) throw new Error(journeyId + ' links to ' + id + ', which is not in the Genome');
    return { id, kind: node.kind, name: nameOf(id), ...(text(detail) && { detail: text(detail) }) };
  };
  const out = (from: string, rel: string) => links.filter(l => l.from === from && l.rel === rel).map(l => l.to);
  const into = (to: string, rel: string) => links.filter(l => l.to === to && l.rel === rel).map(l => l.from);
  const unique = (refs: ModelRef[]) => refs.filter((r, i) => refs.findIndex(x => x.id === r.id) === i);

  const steps = new Map(journey.steps.map(s => [s.id, s]));
  const phaseOfStep = new Map<string, string>();
  const phases: WorkflowPhase[] = journey.segments.map((segment, index) => {
    const id = slug(segment.name);
    const phaseSteps = segment.steps.map((local): WorkflowStep => {
      const step = steps.get(local);
      if (!step) throw new Error(journeyId + ' phase ' + segment.name + ' names a missing step ' + local);
      phaseOfStep.set(local, id);
      const key = journeyId + '/' + local;
      const operations = out(key, 'stepOperation').map(target => byId.get(target)).filter(n => !!n);
      const pick = (kind: string, detail: string) => operations.filter(n => n.kind === kind).map(n => ref(n.id, n.fields[detail]));
      const endpoints = pick('endpoint', 'route');
      const runtime = pick('workflow', 'description');
      const ci = operations.some(n => within(n.id, 'thing.ci'));
      return {
        id: key, actor: step.actor === 'system' && ci ? 'ci' : actors[step.actor] ?? 'platform', action: step.action,
        commands: pick('command', 'usage'), endpoints, runtime,
        screens: out(key, 'stepScreen').map(id => ref(id, byId.get(id)?.fields.route)),
        modules: unique([...endpoints, ...runtime].flatMap(e => into(e.id, 'implements')).filter(id => byId.get(id)?.kind === 'module' && id !== 'module.platform.router').map(id => ref(id, byId.get(id)?.fields.description))),
        journeys: out(key, 'references').filter(id => byId.get(id)?.kind === 'journey').map(id => ref(id, byId.get(id)?.fields.actorGoal)),
        guardrails: into(key, 'governs').filter(id => byId.get(id)?.kind === 'commitment').map(id => ref(id, byId.get(id)?.fields.statement)),
      };
    });
    const all = phaseSteps.flatMap(s => [{ id: s.id }, ...s.commands, ...s.screens, ...s.endpoints, ...s.runtime, ...s.modules, ...s.journeys, ...s.guardrails]);
    return {
      id, index: index + 1, name: segment.name, steps: phaseSteps, parallel: false,
      actors: [...new Set(phaseSteps.map(s => s.actor))], nodeIds: [...new Set(all.map(r => r.id))],
    };
  });

  const edges = journey.steps.flatMap(s => s.next.map(n => ({ from: s.id, to: n.to, when: n.when ?? '' })));
  const fan = edges.find(e => /^for each\b/i.test(e.when)), join = edges.find(e => /^once every\b/i.test(e.when));
  if (!fan || !join) throw new Error(journeyId + ' needs a "for each …" edge and a "once every …" edge to show the parallel Tasks');
  const order = (step: string) => phases.findIndex(p => p.id === phaseOfStep.get(step));
  for (const phase of phases.slice(order(fan.to), order(join.to))) phase.parallel = true;
  const last = phases.at(-1)!;
  const back = edges.find(e => phaseOfStep.get(e.from) === last.id && order(e.to) < order(e.from));
  return {
    journey: { id: journey.id, name: journey.name, goal: journey.actorGoal }, phases, fanOut: fan.when, join: join.when,
    loop: back ? { to: phaseOfStep.get(back.to)!, when: back.when } : null,
  };
}
