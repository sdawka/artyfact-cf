import React from 'react';

type Station = { href: string; name: React.ReactNode; detail: string };
const zones: { place: string; stations: Station[] }[] = [
  { place: 'On the platform', stations: [
    { href: '#start', name: 'Plan and Tasks', detail: 'A reviewed change, split into scoped Tasks.' },
  ] },
  { place: 'On your machine', stations: [
    { href: '#start', name: <code>task claim</code>, detail: 'Run by your coordinator.' },
    { href: '#work', name: 'Fork and packet', detail: 'TASK_PACKET.md, AGENTS.md and a short-lived token.' },
    { href: '#work', name: 'Your agent', detail: 'Any harness. Its own approach.' },
    { href: '#submit', name: <code>task submit</code>, detail: 'Pushes and submits the exact candidate.' },
  ] },
  { place: 'Back on the platform', stations: [
    { href: '#review', name: 'Checks', detail: 'Only a pass is green.' },
    { href: '#review', name: 'Integrate, review, promote', detail: 'One review. Promote refuses a stale head.' },
  ] },
];

/** Static handoff map: an ordered list grouped by where each step runs. The arrows are decorative SVG. */
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
  </figure>;
}
