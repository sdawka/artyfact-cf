import React from 'react';

const columns: { title: string; label: string; items: string[]; note?: string }[] = [
  { title: 'What they need', label: 'Context', items: [
    'The whole model of your product, pinned to one version, in the fork: from the System down to its journeys, screens and rules.',
    'A brief naming the exact parts of that model each Task realizes, with the steps and checks that come from them.',
    'Which finished Tasks it builds on, and which open ones it must not overlap.',
    'What other agents are working on.',
  ], note: 'With the whole model and an exact brief, even a small change can go to a cheaper, weaker model; its result is still validated against the entire model.' },
  { title: 'Guardrails', label: 'Hard to do the wrong thing', items: [
    'A private fork for each Task, with a short-lived token.',
    'Paths they may write, and paths that stay protected. The model in the fork is read-only by default.',
    'Checks bound to the model’s rules.',
    'A promote that refuses unproven or out-of-date work.',
  ] },
  { title: 'Freedom', label: 'Choices stay theirs', items: [
    'Any agent harness or LLM you run.',
    'Their own approach inside the brief.',
    'When the model can’t be built as written, they may change it from their fork and say why. The change is judged against the whole model and reviewed beside the code.',
  ], note: 'Several agents can take the same change in parallel. Each fulfils one tightly defined contract, so any version that meets it should work. If one meets it and still falls short, you sharpen the contract. The variation explores more of the solution space.' },
];

/** Static three-column section: context, guardrails and freedom. */
export function AgentEnvironment() {
  return <section className="section agent-environment" id="environment" aria-labelledby="environment-heading">
    <div className="section-heading"><h2 id="environment-heading">Give your coding agents the environment to thrive.</h2><p>With too few limits, agents drift. With too many, they can’t find a better way. Artyfact stops the wrong moves, hands over what the right ones need, and leaves the choices to the agent.</p></div>
    <div className="environment-columns">
      {columns.map(column => <article key={column.title}>
        <h3>{column.title}</h3>
        <p className="environment-label">{column.label}</p>
        <ul>{column.items.map(item => <li key={item}>{item}</li>)}</ul>
        {column.note && <p className="environment-note">{column.note}</p>}
      </article>)}
    </div>
  </section>;
}
