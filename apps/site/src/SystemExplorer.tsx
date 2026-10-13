import React, { useEffect, useState } from 'react';
import type { SystemSelection } from './systemState';

const layers = [
  { name: 'Genome', meaning: 'What should hold true' },
  { name: 'Proteome', meaning: 'How it is realized' },
  { name: 'Phenome', meaning: 'What is observed' },
] as const;

/** One proposed Artyfact feature, viewed from three angles. The example claims no live work or evidence. */
export function SystemExplorer({ onSelect }: { onSelect?: (selection: SystemSelection) => void }) {
  const [layer, setLayer] = useState(0);
  useEffect(() => { onSelect?.({ layer, subject: 0 }); }, [layer, onSelect]);

  return <section className="explorer model-feature-explorer" aria-label="Illustrative Artyfact feature through three views">
    <header className="explorer-heading">
      <div><p className="example-label">Illustrative target</p><h3>Make changes easy to scope and specify</h3></div>
      <span className="example-system">Artyfact System</span>
    </header>
    <div className="feature-subject">
      <span>Same feature in every view</span>
      <strong>Clarify a requested change before work starts</strong>
    </div>
    <div className="layer-tabs" role="tablist" aria-label="Parallel views of the illustrative feature">
      {layers.map((item, index) => <button key={item.name} role="tab" id={'model-layer-' + index} aria-controls="model-layer-panel"
        aria-selected={layer === index} tabIndex={layer === index ? 0 : -1}
        onClick={() => setLayer(index)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (layer + 1) % 3 : event.key === 'ArrowLeft' ? (layer + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next !== null) { event.preventDefault(); setLayer(next); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }
        }}><span>{item.name}</span><small>{item.meaning}</small></button>)}
    </div>
    <div id="model-layer-panel" className="example-detail" role="tabpanel" aria-labelledby={'model-layer-' + layer} aria-live="polite">
      {layer === 0 ? <>
        <h4>What needs to be clear?</h4>
        <p>The proposed Genome names the requested behavior, affected subjects and acceptance criteria before an agent begins.</p>
        <div className="feature-facts">
          <p><span>Requested behavior</span><strong>Make the scope of a change inspectable.</strong></p>
          <p><span>Affected subjects</span><strong>Evolution, scope editor, affected-node map.</strong></p>
          <p><span>Criterion</span><strong>A reviewer can see the intended change and its affected subjects before work starts.</strong></p>
        </div>
        <p className="evidence-note">A declared criterion is a target, not evidence that the feature exists.</p>
      </> : layer === 1 ? <>
        <h4>Your agents can be the Proteome.</h4>
        <p>An agent could receive the scoped intent, implement the interface and mapping, then submit a candidate for review.</p>
        <p className="feature-test"><span>Proposed acceptance test</span>Given a requested change, when a reviewer opens it before work starts, then its intended behavior and affected subjects are visible.</p>
        <div className="feature-facts">
          <p><span>Work</span><strong>Implement the scope editor and mapping.</strong></p>
          <p><span>Check</span><strong>Run the proposed acceptance test against the candidate.</strong></p>
          <p><span>Instrumentation</span><strong>Emit events that could connect input, intent and mapping.</strong></p>
        </div>
        <p className="evidence-note">This is an illustrative target. It does not show an agent running or a passing test.</p>
      </> : <>
        <h4>What could the System observe?</h4>
        <p>This sample event stream shows the observations the feature would need to relate. Every event below shares the illustrative change reference <code>example-scope-01</code>. It is a proposed stream, not live Artyfact telemetry.</p>
        <ol className="feature-events" aria-label="Proposed event stream">
          <li>Input received</li><li>Intent confirmed</li><li>Change mapped</li><li>Evaluation completed</li>
        </ol>
        <p className="evidence-note">Correlated events and a completed check would still not prove that scoping feels easy to people.</p>
      </>}
    </div>
    <p className="explorer-caption">Genome, Proteome and Phenome are parallel views of this feature, not successive build stages.</p>
  </section>;
}
