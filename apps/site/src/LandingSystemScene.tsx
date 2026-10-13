import React, { useId } from 'react';
import { landingSubjects } from './landingSystemData';
import type { LandingDemo, LandingSubject, LandingView } from './landingSystemData';

export type LandingSystemSceneProps = {
  view: LandingView;
  selectedSubject: LandingSubject;
  onSelectSubject?: (subject: LandingSubject) => void;
  demo?: LandingDemo;
};

const emptyDemo: LandingDemo = { count: 0, pressing: false, showPointer: false, celebrating: false, showToast: false, onSave: () => {} };
const confettiPieces = Array.from({ length: 18 }, (_, index) => index);

export function LandingSystemScene({ view, selectedSubject, onSelectSubject, demo = emptyDemo }: LandingSystemSceneProps) {
  const headingId = useId();
  const noteId = useId();
  const detail = landingSubjects[selectedSubject];
  const shape = view === 'genome';
  const active = view === 'phenome';
  const chartLevel = Math.min(12, Math.max(0, demo.count));
  const selectProps = (subject: LandingSubject) => ({
    type: 'button' as const,
    'aria-pressed': selectedSubject === subject,
    onClick: () => onSelectSubject?.(subject),
  });
  return <div className="landing-system-scene" data-scene-view={view}>
    <figure className="scene-system" aria-labelledby={headingId}>
      <figcaption className="scene-system-heading">
        <h2 id={headingId}>One System</h2>
        <span className="scene-example-label">Illustrative application</span>
      </figcaption>
      <div className="scene-board">
        <div className="scene-observation-slot">
          {active && <div className="scene-save-chart" role="img" aria-label={`Sample saves: ${demo.count}. Bar shown up to 12 saves.`}>
            <span className="scene-chart-caption">Sample saves</span>
            <div className="scene-chart-plot">
              <div className="scene-chart-ticks" aria-hidden="true"><span>12+</span><span>6</span><span>0</span></div>
              <div className="scene-chart-track" aria-hidden="true"><div className="scene-chart-bar" data-chart-level={chartLevel} style={{ '--chart-fill': chartLevel / 12 } as React.CSSProperties} /></div>
            </div>
            <strong>{demo.count} {demo.count === 1 ? 'save' : 'saves'}</strong>
          </div>}
        </div>
        <article className="scene-card scene-application" aria-label="Application: Fieldnotes" data-selected={selectedSubject === 'app'}>
          <div className="scene-card-heading"><span>Application</span><button {...selectProps('app')} className="scene-inspect" aria-label="Inspect Fieldnotes application">Inspect</button></div>
          <div className="scene-app-body">
            <div className="scene-app-brand">{shape ? <span className="scene-slot-purpose">Fieldnotes interface</span> : <><h3>Fieldnotes</h3><p>Capture what you notice.</p></>}</div>
            <div className="scene-form-slot scene-shape-slot">{shape ? <span className="scene-slot-purpose">Capture a note</span> : <><label htmlFor={noteId}>New note</label><input id={noteId} value="Morning by the lake" readOnly tabIndex={-1} /></>}</div>
            <div className="scene-save-slot scene-shape-slot">{shape ? <span className="scene-slot-purpose">Save a note</span> : active ? <button type="button" className="scene-save" data-pressing={demo.pressing} onClick={demo.onSave}>Save record</button> : <span className="scene-save scene-save-preview">Save record</span>}
              {active && demo.showPointer && <svg className="scene-demo-pointer" data-demo-pointer aria-hidden="true" focusable="false" viewBox="0 0 26 32"><path d="M3 2 22 20l-10 1-4 9Z" /></svg>}
            </div>
            <div className="scene-list-slot scene-shape-slot">{shape ? <span className="scene-slot-purpose">Revisit saved notes</span> : <><span className="scene-list-label">Saved notes</span><ul><li>Morning by the lake</li><li>The long way home</li></ul></>}</div>
          </div>
          {active && demo.celebrating && <div className="scene-confetti" data-scene-confetti aria-hidden="true">{confettiPieces.map(index => <i key={index} />)}</div>}
        </article>
        <article className="scene-runtime" aria-label="Runtime: API and storage" data-selected={selectedSubject === 'runtime'}>
          <div className="scene-card-heading"><span>Runtime</span><button {...selectProps('runtime')} className="scene-inspect" aria-label="Inspect API and storage">Inspect</button></div>
          <div className="scene-api scene-shape-slot"><span className="scene-slot-purpose">Records API</span>{!shape && <code>/api/records</code>}</div>
          <span className="scene-runtime-link">persists</span>
          <div className="scene-storage scene-shape-slot"><span className="scene-slot-purpose">Record storage</span>{!shape && <span className="scene-storage-lines" aria-hidden="true"><i /><i /><i /></span>}</div>
        </article>
      </div>
      <div className="scene-composition-rail" aria-label="Composed Parts"><span>Parts</span><button {...selectProps('starter')} aria-label="Part: Astro starter">Astro starter</button><span aria-hidden="true">+</span><button {...selectProps('components')} aria-label="Part: Component system">Component system</button><span className="scene-composition-target">compose this app</span></div>
      <div className="scene-feedback-slot">{active && demo.showToast && <p className="scene-demo-toast" role="status" aria-live="polite">Great energy!</p>}</div>
    </figure>
    <section className="scene-selected-detail" aria-label="Selected subject">
      <h3>{detail.title}</h3>
      <p>{detail.summary[view]}</p>
      <details key={selectedSubject}>
        <summary>Composition + provenance</summary>
        <p>{detail.detail}</p>
        <p className="scene-relationships">Parts compose the application. Application calls API; API persists records.</p>
        <p className="scene-outcome">Outcome evidence: unmeasured.</p>
      </details>
    </section>
  </div>;
}
