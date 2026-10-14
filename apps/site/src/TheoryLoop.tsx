import React from 'react';

const steps = [
  { name: 'Theory', title: 'Write the theory down', term: 'Evolution', line: 'Propose a change to the model and agree on it before any code.',
    body: 'Ask your agent for a change and review it as an Evolution: the purpose, the claims it touches and the criteria the work must meet. An Evolution changes the Genome. Accepting it records a new Genome revision.' },
  { name: 'Build', title: 'Build against it', term: 'Realization · Tasks', line: 'Split the accepted change into Tasks for one or more agents.',
    body: 'A Realization pins the accepted Genome revision and breaks the work into Tasks. Each Task names its subjects, the paths it may read and write, and its dependencies. Each Task gets its own Git fork with one active writer.' },
  { name: 'Check', title: 'Check the work', term: 'verdicts', line: 'Run the checks bound to the model’s criteria.',
    body: 'Agents checkpoint and submit exact candidates. Checks bound to criteria give a verdict: pass, fail, unknown, stale or waived. A check that did not run stays unknown, and unknown blocks.' },
  { name: 'Ship', title: 'Ship the combined result', term: 'promote', line: 'Review the integrated implementation, then promote it.',
    body: 'Select a candidate for each Task, integrate them and review the combined implementation against the accepted Genome. Promoting is a separate approval from accepting the Evolution. Deploying is a separate action again.' },
  { name: 'Observe', title: 'Watch what happens', term: 'Phenome', line: 'See deployments, runtime metrics and feature flags.',
    body: 'The Phenome connects deployments, Cloudflare runtime metrics, custom measurements and feature flags. A deployment or a metric alone does not prove an outcome. Measuring claim indicators is still in progress.' },
  { name: 'Revise', title: 'Revise the theory', term: 'claim status', line: 'Update what you believe, then start the next change.',
    body: 'Record whether the evidence supports or challenges the claim, or leaves it inconclusive. The next Evolution names the claims it affects, so the theory and the product move together.' },
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
