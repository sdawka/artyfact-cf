import React from 'react';
import type { Actor, ModelRef, Workflow, WorkflowPhase, WorkflowStep } from './workflow';

const who: Record<Actor, { label: string; subject: string; text: string }> = {
  person: { label: 'Person', subject: 'A person', text: 'You, or whoever coordinates the work.' },
  agent: { label: 'Agent', subject: 'The agent', text: 'The coding agent you run on your own machine.' },
  platform: { label: 'Platform', subject: 'Artyfact', text: 'The Artyfact Worker and its Durable Object.' },
  ci: { label: 'CI', subject: 'CI', text: 'The artyfact-ci Workflow, building in a container.' },
};
const kindLabel: Record<string, string> = { step: 'Step', command: 'Command', endpoint: 'Endpoint', screen: 'Screen', workflow: 'Workflow', module: 'Module', journey: 'Journey', commitment: 'Commitment' };

/** Site-side copy that the Genome does not hold yet: the platform's judge for the Checks phase, keyed by step id. */
const notes: Record<string, React.ReactNode> = {
  'J.lifecycle/check': <>Cloudflare Clef, an open-weight decision model on Workers AI, is the default production judge. Visual criteria always go to Clef: screenshots of the candidate’s CI preview, captured with Cloudflare Browser Run at 1280×800 and 390×844, and up to four the agent attaches with <code>artyfact task submit --screenshot page.png</code>. Each image is labelled with its source and stored in R2. Clef returns a probability: 0.9 or above passes, 0.1 or below fails with a named concern such as broken layout or unreadable text, and anything between stays unknown. Without screenshots the check is not run; it is never judged from text alone.</>,
};

const sentence = (step: WorkflowStep) => who[step.actor].subject + ' ' + step.action.charAt(0).toLowerCase() + step.action.slice(1);
const firstSentence = (text: string) => text.match(/^.*?[.!?](\s|$)/)?.[0].trim() ?? text;
const once = (refs: ModelRef[]) => refs.filter((r, i) => refs.findIndex(x => x.id === r.id) === i);

function ActorChip({ actor }: { actor: Actor }) {
  return <span className="flow-actor" data-actor={actor}><span className="flow-actor-mark" aria-hidden="true" />{who[actor].label}</span>;
}

function Uses({ steps }: { steps: WorkflowStep[] }) {
  const commands = once(steps.flatMap(s => s.commands)), screens = once(steps.flatMap(s => s.screens));
  const endpoints = once(steps.flatMap(s => s.endpoints)), runtime = once(steps.flatMap(s => s.runtime));
  return <>
    {commands.length > 0 && <ul className="flow-commands">{commands.map(c => <li key={c.id}><code>{c.detail}</code></li>)}</ul>}
    <ul className="flow-uses">
      {screens.map(s => <li key={s.id}><span>Screen</span> {s.name} <code>{s.detail}</code></li>)}
      {runtime.map(r => <li key={r.id}><span>CI Workflow</span> {r.name}</li>)}
      {endpoints.map(e => <li key={e.id}><span>API</span> <code>{e.detail}</code></li>)}
    </ul>
  </>;
}

function Phase({ phase }: { phase: WorkflowPhase }) {
  const guardrails = once(phase.steps.flatMap(s => s.guardrails));
  const kinds = new Map(phase.steps.flatMap(s => [{ id: s.id, kind: 'step' }, ...s.commands, ...s.screens, ...s.endpoints, ...s.runtime, ...s.modules, ...s.journeys, ...s.guardrails]).map(r => [r.id, r.kind]));
  const note = phase.steps.map(s => notes[s.id]).find(Boolean);
  return <li className="flow-phase" id={'phase-' + phase.id} data-phase={phase.id} data-parallel={phase.parallel || undefined}>
    <details>
      <summary>
        <span className="flow-node" aria-hidden="true">{phase.index}</span>
        <span className="flow-head">
          <strong className="flow-name">{phase.name}{phase.parallel && <span className="term-label">once per Task</span>}</strong>
          <span className="flow-line">{firstSentence(sentence(phase.steps[0]!))}</span>
        </span>
        <span className="flow-actors">{phase.actors.map(actor => <ActorChip key={actor} actor={actor} />)}</span>
        <span className="flow-toggle" aria-hidden="true" />
      </summary>
      <dl className="flow-body">
        <div className="flow-what"><dt>What happens</dt><dd><ol className="flow-steps">
          {phase.steps.map(step => <li key={step.id} data-actor={step.actor}><ActorChip actor={step.actor} /><p>{sentence(step)}</p></li>)}
        </ol>{note && <p className="flow-note">{note}</p>}</dd></div>
        <div className="flow-who"><dt>Who acts</dt><dd><ul>{phase.actors.map(actor => <li key={actor}><ActorChip actor={actor} /> <span>{who[actor].text}</span></li>)}</ul></dd></div>
        <div className="flow-how"><dt>Command or screen</dt><dd><Uses steps={phase.steps} /></dd></div>
        <div className="flow-guards"><dt>Guardrails</dt><dd>{guardrails.length
          ? <ul>{guardrails.map(g => <li key={g.id}>{g.detail}</li>)}</ul>
          : <p>{phase.actors.every(actor => actor === 'person') ? 'A person decides here. Nothing changes until they act.' : 'None modeled for this phase yet.'}</p>}</dd></div>
        <div className="flow-ids"><dt>In the model</dt><dd><ul aria-label={'Model nodes for ' + phase.name}>
          {phase.nodeIds.map(id => <li key={id} data-model-node={id}><span>{kindLabel[kinds.get(id) ?? ''] ?? kinds.get(id)}</span> <code>{id}</code></li>)}
        </ul></dd></div>
      </dl>
    </details>
  </li>;
}

function Fork({ join }: { join?: boolean }) {
  // Three Task lanes leave the spine (or return to it). Decorative: the list and its labels carry the meaning.
  return <svg className={'flow-fork' + (join ? ' flow-fork-join' : '')} viewBox="0 0 96 48" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M48 0v48" /><path d="M48 0C48 26 14 22 14 48" /><path d="M48 0C48 26 82 22 82 48" />
  </svg>;
}

/** The workflow diagram. Static markup: every phase is a native disclosure, so it reads and opens without JavaScript. */
export function WorkflowDiagram({ workflow }: { workflow: Workflow }) {
  const first = workflow.phases.findIndex(p => p.parallel);
  const before = workflow.phases.slice(0, first), parallel = workflow.phases.filter(p => p.parallel);
  const after = workflow.phases.slice(first + parallel.length);
  const loopTarget = workflow.phases.find(p => p.id === workflow.loop?.to);
  return <figure className="flow" aria-labelledby="flow-caption" data-workflow={workflow.journey.id}>
    <figcaption id="flow-caption">{workflow.journey.name}: {workflow.phases.length} phases, from <code>{workflow.journey.id}</code> in Artyfact’s model.</figcaption>
    <ul className="flow-legend" aria-label="Who acts">{(Object.keys(who) as Actor[]).map(actor => <li key={actor}><ActorChip actor={actor} /><span>{who[actor].text}</span></li>)}</ul>
    <ol className="flow-spine">
      {before.map(phase => <Phase key={phase.id} phase={phase} />)}
      <li className="flow-fan">
        <div className="flow-fan-label"><Fork /><p><strong>The work fans out</strong> {workflow.fanOut}. Each Task gets its own fork, its own brief and its own agent, so several agents work at once without touching each other’s files.</p></div>
        <ol className="flow-spine flow-parallel" start={parallel[0]?.index}>{parallel.map(phase => <Phase key={phase.id} phase={phase} />)}</ol>
        <div className="flow-fan-label flow-join-label"><Fork join /><p><strong>The work joins again</strong> {workflow.join}. One candidate per Task goes forward to a single review.</p></div>
      </li>
      {after.map(phase => <Phase key={phase.id} phase={phase} />)}
    </ol>
    {loopTarget && <p className="flow-loop"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M19 15a7 7 0 1 1-2-8.5M19 3v4h-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Then around again, for {workflow.loop!.when}: <a href={'#phase-' + loopTarget.id}>{loopTarget.index}. {loopTarget.name}</a></span></p>}
  </figure>;
}

export function HowItWorks({ workflow }: { workflow: Workflow }) {
  const steps = workflow.phases.flatMap(p => p.steps);
  const nodes = new Set(workflow.phases.flatMap(p => p.nodeIds));
  const guardrails = new Set(steps.flatMap(s => s.guardrails.map(g => g.id)));
  return <div className="how" data-how-it-works="">
    <section className="page-intro how-intro">
      <h1>How it works</h1>
      <p className="lead">How one change moves through Artyfact: from a description of the product to code running in production, and back again.</p>
      <p className="intro-text">People decide what changes. Agents build it, each in a private fork. Artyfact checks the work against the model and refuses anything stale. Open a phase to see who acts, what they run and what keeps the change safe.</p>
    </section>
    <section className="how-source" aria-labelledby="how-source-heading">
      <h2 id="how-source-heading">Drawn from Artyfact’s own model.</h2>
      <p>The site’s build reads the repository’s <code>genome/</code> with the same loader the platform uses, and draws this diagram from one journey in it. Every id you see is a real node in that model. This page is one too: <code>page.how-it-works</code>.</p>
      <p className="how-counts"><strong>{workflow.phases.length}</strong> phases, <strong>{steps.length}</strong> steps, <strong>{nodes.size}</strong> linked model nodes and <strong>{guardrails.size}</strong> guardrails, read when the site was built.</p>
    </section>
    <section className="section how-flow" id="workflow" aria-labelledby="workflow-heading">
      <div className="section-heading"><h2 id="workflow-heading">From idea to production.</h2><p>{workflow.journey.goal}.</p></div>
      <WorkflowDiagram workflow={workflow} />
    </section>
    <section className="section closing how-close"><h2>Try it with your own agent.</h2><div><p>The agent guide walks through each command on this page. The theory explains why the model comes first.</p><div className="model-close-actions"><a className="button primary u-brackets" href="/connect-agent">Bring your agent</a><a className="text-link" href="/model">Read the theory</a></div></div></section>
  </div>;
}
