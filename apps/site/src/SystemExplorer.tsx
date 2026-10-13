import React, { useEffect, useState } from 'react';
import type { SystemSelection } from './systemState';

export const subjects = [
  { name: 'Keep in Touch app', kind: 'Thing', intent: 'A Thing can begin with its Genome alone: purpose, structure and contracts, before Parts or source exist.', work: 'Two isolated realizations', workDetail: 'A System is the context and governance wrapper, even when this one Thing is the whole application.', observation: 'Runtime evidence resolves through the authoritative Thing, source and realized-output association.' },
  { name: 'A private relationship', kind: 'Entity', intent: 'Private notes belong to their author.', work: 'A contract to preserve', workDetail: 'Optional Parts can contribute a partial or complete capability at any scale. Composition and upgrades are explicit and save provenance.', observation: 'A passing storage check would not prove that every access path is private.' },
  { name: 'Wanted contact', kind: 'Purpose', intent: 'More wanted contact, less effort remembering.', work: 'Work with a reason', workDetail: 'Source and realized output stay distinct, so a build can be linked to the source and Genome it came from.', observation: 'Outcomes need observations from people, with a time and context.' },
];
export const layers = [
  { name: 'Genome', meaning: 'The intent', description: 'What should hold true.' },
  { name: 'Proteome', meaning: 'The work', description: 'Who realizes and checks it.' },
  { name: 'Phenome', meaning: 'The evidence', description: 'What can be observed.' },
];

/** `onSelect` hears every layer or subject change (and the initial state after mount); the markup does not depend on it. */
export function SystemExplorer({ onSelect }: { onSelect?: (selection: SystemSelection) => void }) {
  const [layer, setLayer] = useState(0);
  const [subject, setSubject] = useState(0);
  useEffect(() => { onSelect?.({ layer, subject }); }, [layer, subject, onSelect]);
  const selected = subjects[subject];
  return <section className="explorer" aria-label="Interactive Keep in Touch example">
    <div className="explorer-heading"><span>Keep in Touch</span><span className="example-label">Illustrative System</span></div>
    <div className="layer-tabs" role="tablist" aria-label="Layers of the same System">
      {layers.map((item, index) => <button key={item.name} role="tab" id={'layer-' + index} aria-controls="system-panel"
        aria-selected={layer === index} tabIndex={layer === index ? 0 : -1}
        onClick={() => setLayer(index)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (layer + 1) % 3 : event.key === 'ArrowLeft' ? (layer + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next !== null) { event.preventDefault(); setLayer(next); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }
        }}><span>{item.name}</span><small>{item.meaning}</small></button>)}
    </div>
    <div className="subject-map">
      <p className="map-purpose">A System for the relationships you choose.</p>
      <div className="map-stem" aria-hidden="true"><span /></div>
      <div className="subject-choices">{subjects.map((item, index) => <button className="subject u-brackets" aria-pressed={subject === index}
        key={item.name} onClick={() => setSubject(index)}><small>{item.kind}</small><span>{item.name}</span></button>)}</div>
    </div>
    <div id="system-panel" className="example-detail" role="tabpanel" aria-labelledby={'layer-' + layer} aria-live="polite">
      <p className="detail-context">{layers[layer].description}</p>
      {layer === 0 ? <><p className="detail-title">{selected.intent}</p><p>A declared contract. Its purpose, policies and acceptance criteria give the work its context.</p><span className="evidence-note">Intent is not implementation evidence.</span></>
        : layer === 1 ? <><p className="detail-title">{selected.work}</p><p>{selected.workDetail}</p><div className="forks" aria-label="Two candidate workspaces"><span>Realization A</span><span>Realization B</span></div><span className="evidence-note">Isolated work. Shared subjects. Explicit review.</span></>
        : <><p className="detail-title">{selected.observation}</p><div className="observation"><span>Observed result</span><strong>Unknown</strong></div><p>No live evaluation is being claimed by this example. A planned check and a completed check are different things.</p></>}
    </div>
    <p className="explorer-caption">Choose a subject. Change the layer. It is still the same System.</p>
  </section>;
}
