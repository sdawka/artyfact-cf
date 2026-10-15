import React from 'react';

const steps = [
  { name: 'Theory', title: 'Write the theory down', term: 'Evolution', line: 'Propose a change to the model and agree on it before any code.',
    body: 'An Evolution is a proposed change to the model. Ask your agent for one, then review the purpose, the claims it touches and the criteria the work must meet. Accepting it records a new Genome revision.' },
  { name: 'Build', title: 'Build against it', term: 'Realization · Tasks', line: 'Split the accepted change into Tasks for one or more agents.',
    body: 'A Realization is a build plan pinned to the accepted Genome revision. It breaks the work into Tasks. Each Task names its subjects, the paths it may read and write, and its dependencies. Each Task gets its own Git fork with one active writer.' },
  { name: 'Check', title: 'Check the work', term: 'verdicts', line: 'Run the checks bound to the model’s criteria.',
    body: 'Each agent submits a candidate: one submitted version of its Task’s work. Checks bound to criteria give a verdict: pass, fail, unknown, stale or waived. Only a pass is green. A check that did not run stays unknown, and unknown blocks.' },
  { name: 'Ship', title: 'Ship the combined result', term: 'promote', line: 'Review the integrated implementation, then promote it.',
    body: 'Select a candidate for each Task, integrate them and review the result against the accepted Genome. To promote is to make the reviewed result the System’s current state, and only if nothing changed since the review. It is a separate approval from accepting the Evolution. Deploying is a separate step again.' },
  { name: 'Observe', title: 'Watch what happens', term: 'Phenome', line: 'See what each deployment did.',
    body: 'The Phenome links runtime events and deployments to the commit that produced them. A deployment or an event alone does not prove an outcome. Measuring claim indicators is in progress.' },
  { name: 'Revise', title: 'Revise the theory', term: 'claim status', line: 'Update what you believe, then start the next change.',
    body: 'Record whether the evidence supports or challenges the claim, or leaves it inconclusive. The next Evolution names the claims it affects, so the theory and the product move together. A product keeps evolving with the people who build and use it, so the theory does too.' },
] as const;

const R = 112, C = 160;
const at = (index: number, radius = R) => {
  const angle = (index * 60 - 90) * Math.PI / 180;
  return { x: +(C + radius * Math.cos(angle)).toFixed(1), y: +(C + radius * Math.sin(angle)).toFixed(1) };
};

/** Decorative ring; the ordered list beside it carries the content. Each node lights up when its step is open (CSS :has). */
function LoopRing() {
  return <svg className="theory-loop-ring" viewBox="-50 0 420 320" aria-hidden="true" focusable="false">
    <circle className="loop-track" cx={C} cy={C} r={R} />
    <circle className="loop-flow" cx={C} cy={C} r={R} pathLength={600} />
    {steps.map((step, index) => {
      const node = at(index), label = at(index, R + 30);
      const anchor = Math.abs(label.x - C) < 4 ? 'middle' : label.x > C ? 'start' : 'end';
      return <g key={step.name} className={'loop-node loop-node-' + (index + 1)}>
        <circle cx={node.x} cy={node.y} r={15} />
        <text className="loop-index" x={node.x} y={node.y} dy="0.35em">{index + 1}</text>
        <text className="loop-label" x={label.x} y={label.y} dy="0.35em" textAnchor={anchor}>{step.name}</text>
      </g>;
    })}
    <text className="loop-center" x={C} y={C - 8}>every change</text>
    <text className="loop-center" x={C} y={C + 12}>goes around</text>
  </svg>;
}

/** The six steps a change takes, as static details so every step reads without JavaScript. */
export function TheoryLoop() {
  return <div className="theory-loop">
    <LoopRing />
    <ol className="model-lifecycle-steps theory-loop-steps" aria-label="The six steps of the loop">
      {steps.map(step => <li key={step.name} data-loop-step={step.name.toLowerCase()}>
        <details><summary><span className="theory-loop-title"><strong>{step.title}</strong> <span className="term-label">{step.term}</span></span><span className="theory-loop-toggle" aria-hidden="true" /><span className="theory-loop-line">{step.line}</span></summary><p>{step.body}</p></details>
      </li>)}
    </ol>
  </div>;
}
