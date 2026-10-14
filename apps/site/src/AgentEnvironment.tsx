import React from 'react';

type Zone = { id: 'context' | 'guardrails' | 'freedom'; title: string; label: string; items: string[] };

const zones: Zone[] = [
  { id: 'context', title: 'What they need', label: 'Context', items: [
    'The model of your product at one pinned version, from the System down to its journeys, screens and rules.',
    'The parts of that model each Task reads and changes, with the steps and checks that come from them.',
    'Which finished Tasks it builds on, and which open ones it must not overlap.',
    'What other agents are working on.',
  ] },
  { id: 'guardrails', title: 'Guardrails', label: 'Hard to do the wrong thing', items: [
    'A private fork for each Task, with a short-lived token.',
    'Paths they may write, and paths that stay protected, the model included.',
    'Checks bound to the model’s rules.',
    'A promote that refuses unproven or out-of-date work.',
  ] },
  { id: 'freedom', title: 'Freedom', label: 'Choices stay theirs', items: [
    'Any agent harness or LLM you run.',
    'Their own approach inside the brief.',
    'When the model looks wrong, they can say so. The change to it is reviewed like any other.',
  ] },
];

/** Static: three zones of one Task seen from the agent's side (the brief it gets, the frame around it, the room inside),
 * then the one sentence about parallel agents pulled out of the prose. */
export function AgentEnvironment() {
  return <section className="section agent-environment" id="environment" aria-labelledby="environment-heading">
    <div className="section-heading"><h2 id="environment-heading">Give your coding agents the environment to thrive.</h2><p>With too few limits, agents drift. With too many, they can’t find a better way. Artyfact stops the wrong moves, hands over what the right ones need, and leaves the choices to the agent.</p></div>
    <div className="environment-columns" role="group" aria-label="One Task, from the agent’s side">
      {zones.map(zone => <article key={zone.id} data-zone={zone.id}>
        <h3>{zone.title}</h3>
        <p className="environment-label">{zone.label}</p>
        <ul>{zone.items.map(item => <li key={item}>{item}</li>)}</ul>
      </article>)}
    </div>
    <div className="environment-parallel">
      <p className="environment-pull">Several agents can take the same change in parallel.</p>
      <p>Each fulfils one tightly defined contract, so any version that meets it should work. If one meets it and still falls short, you sharpen the contract. The variation explores more of the solution space.</p>
    </div>
  </section>;
}
