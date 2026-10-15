import React from 'react';

type Station = { href: string; name: React.ReactNode; detail: string };
// Mirrors the platform: lifecycle-service.ts forks the app repo per Task, seeds the pinned Genome under system/ and
// runs the model's checks on submit (a changed system/ becomes a model delta); system-authority.ts promotes with a
// compare-and-swap on the System head.
const zones: { place: string; stations: Station[] }[] = [
  { place: 'On the platform', stations: [
    { href: '#start', name: 'Plan against the model', detail: 'An accepted change to the model, split into Tasks.' },
  ] },
  { place: 'On your machine', stations: [
    { href: '#start', name: <code>task claim</code>, detail: 'Forks the app’s repo for this Task and clones it.' },
    { href: '#work', name: 'Fork and brief', detail: 'The code, the pinned model under system/, and a brief naming what to realize.' },
    { href: '#work', name: 'Your agent', detail: 'Changes the code its own way, the model only when it can’t be built as written.' },
    { href: '#submit', name: <code>task submit</code>, detail: 'Pushes and submits the exact commit, like a pull request.' },
  ] },
  { place: 'Back on the platform', stations: [
    { href: '#submit', name: 'Checks from the model', detail: 'Three layers: the model holds, the code realizes it, the running thing behaves. Only a pass is green.' },
    { href: '#review', name: 'Review and promote', detail: 'One review, then the merge. Refused if the System moved.' },
  ] },
];

/** Static handoff map: an ordered list grouped by where each step runs, over the pinned model. The arrows are decorative SVG. */
export function HandoffDiagram() {
  let step = 0;
  return <figure className="handoff" aria-labelledby="handoff-caption">
    <figcaption id="handoff-caption">How a Task travels from the platform to your agent and back.</figcaption>
    <div className="handoff-zones">
      {zones.map(zone => <div key={zone.place} className="handoff-zone" data-stations={zone.stations.length}>
        <p className="handoff-place">{zone.place}</p>
        <ol start={step + 1}>
          {zone.stations.map(station => { step++; return <li key={station.href + step} className="handoff-station">
            <a href={station.href}><span className="handoff-step" aria-hidden="true">{step}</span><span className="handoff-name">{station.name}</span></a>
            <p>{station.detail}</p>
            <svg className="handoff-arrow" viewBox="0 0 24 12" width="24" height="12" aria-hidden="true" focusable="false"><path d="M1 6h20M16 1.5 21 6l-5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </li>; })}
        </ol>
      </div>)}
    </div>
    <p className="handoff-model"><strong>The model, pinned to one version.</strong> Every step reads from it. An accepted change to the model makes a new version; an agent may propose one from its fork when the model can’t be built as written.</p>
  </figure>;
}
