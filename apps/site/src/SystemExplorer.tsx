import React, { useEffect, useState } from 'react';
import type { SystemSelection } from './systemState';

const layers = [
  { name: 'Genome', meaning: 'What it should be' },
  { name: 'Proteome', meaning: 'What is being made' },
  { name: 'Phenome', meaning: 'What it does' },
] as const;

/** The canonical model-page component, viewed from three angles without inventing runtime evidence. */
export function SystemExplorer({ onSelect }: { onSelect?: (selection: SystemSelection) => void }) {
  const [layer, setLayer] = useState(0);
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => { setEnhanced(true); }, []);
  useEffect(() => { onSelect?.({ layer, subject: 0 }); }, [layer, onSelect]);

  return <section className="explorer model-feature-explorer" data-enhanced={enhanced} aria-label="Ontology explanation through three views">
    <header className="explorer-heading">
      <div><p className="meta">Declared in the Genome</p><h3>Explain Artyfact clearly</h3></div>
      <span className="example-system">Artyfact System</span>
    </header>
    <div className="feature-subject">
      <span>Same component in every view</span>
      <strong>Ontology explanation on this model page</strong>
    </div>
    <div className="layer-tabs" role={enhanced ? 'tablist' : undefined} aria-label="Parallel views of the explanation component" hidden={!enhanced}>
      {layers.map((item, index) => <button key={item.name} role={enhanced ? 'tab' : undefined} id={'model-layer-' + index} aria-controls={'model-layer-panel-' + index}
        aria-selected={enhanced ? layer === index : undefined} tabIndex={layer === index ? 0 : -1}
        onClick={() => setLayer(index)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (layer + 1) % 3 : event.key === 'ArrowLeft' ? (layer + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next !== null) { event.preventDefault(); setLayer(next); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }
        }}><strong>{item.name}</strong>{' '}<span>{item.meaning}</span></button>)}
    </div>
    <div className="model-view-panels">
      <section id="model-layer-panel-0" className="example-detail" role={enhanced ? 'tabpanel' : undefined} aria-labelledby={enhanced ? 'model-layer-0' : undefined} tabIndex={enhanced ? 0 : undefined} hidden={enhanced && layer !== 0}>
        <p className="model-story-view-name" hidden={enhanced}>What it should be · Genome</p>
        <h4>What should this explanation achieve?</h4>
        <p>The canonical Genome names this page, its explanation component, its purpose and three criteria.</p>
        <div className="feature-facts">
          <p><span>Purpose</span><strong>Explain Artyfact and how its model works.</strong></p>
          <p><span>Subject</span><strong>component.model-explanation inside page.model.</strong></p>
          <p><span>Criterion</span><strong>Represent Artyfact accurately, communicate clearly and make the visual compelling.</strong></p>
        </div>
        <p className="evidence-note">These criteria are declared expectations. Clarity and visual quality still need human review.</p>
      </section>
      <section id="model-layer-panel-1" className="example-detail" role={enhanced ? 'tabpanel' : undefined} aria-labelledby={enhanced ? 'model-layer-1' : undefined} tabIndex={enhanced ? 0 : undefined} hidden={enhanced && layer !== 1}>
        <p className="model-story-view-name" hidden={enhanced}>What is being made · Proteome</p>
        <h4>Your agents do the making.</h4>
        <p>Agents can work on the words, illustration and controls, then check that version and submit it for review.</p>
        <p className="feature-test"><span>Acceptance check</span>Given this model page, its named subjects and criteria agree with the canonical Genome; all three views remain readable without JavaScript.</p>
        <div className="feature-facts">
          <p><span>Work</span><strong>Write, render and refine this explanation.</strong></p>
          <p><span>Check</span><strong>Run content, accessibility and responsive checks.</strong></p>
          <p><span>Review</span><strong>Ask readers whether the words and visual help.</strong></p>
        </div>
        <p className="evidence-note">This describes the work and checks, not an agent running or a passing result.</p>
      </section>
      <section id="model-layer-panel-2" className="example-detail" role={enhanced ? 'tabpanel' : undefined} aria-labelledby={enhanced ? 'model-layer-2' : undefined} tabIndex={enhanced ? 0 : undefined} hidden={enhanced && layer !== 2}>
        <p className="model-story-view-name" hidden={enhanced}>What it does · Phenome</p>
        <h4>What do readers actually understand?</h4>
        <p>A future observation could connect a reader’s visit, exploration and feedback to this component and page version. The sequence below is illustrative, not live Artyfact telemetry. Example reference: <code>example-model-01</code>.</p>
        <ol className="feature-events" aria-label="Illustrative reader observations">
          <li>Page read</li><li>Views explored</li><li>Reader feedback</li><li>Understanding reviewed</li>
        </ol>
        <p className="evidence-note">Visits and clicks alone cannot establish clarity or visual quality. Reader feedback remains unmeasured here.</p>
      </section>
    </div>
    <p className="explorer-caption">Three views of the same component at the same time, not steps one after another.</p>
  </section>;
}
