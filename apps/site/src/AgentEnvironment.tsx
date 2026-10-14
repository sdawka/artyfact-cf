import React from 'react';

const columns = [
  { title: 'What they need', label: 'Context', items: [
    'A brief cut from the model: the purpose and the criteria to meet.',
    'The related screens, data and journeys.',
    'The rules up front, not after review.',
    'What other agents are working on.',
  ] },
  { title: 'Guardrails', label: 'Can’t do the wrong thing', items: [
    'A private fork for each Task, with a short-lived token.',
    'Paths they may write, and paths that stay protected.',
    'Checks bound to the model’s rules.',
    'A promote that refuses unproven or out-of-date work.',
  ] },
  { title: 'Freedom', label: 'Choices stay theirs', items: [
    'Any agent harness or model you run.',
    'Their own approach inside the brief.',
    'Several agents can take the same change in parallel. Each fulfils one tightly defined contract, so any version that meets it should work. If one meets it and still falls short, you sharpen the contract. The variation explores more of the solution space.',
    'They can propose a change to the model itself, reviewed like any other change.',
  ] },
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
      </article>)}
    </div>
  </section>;
}
