import React, { useId } from 'react';
import { landingConstellationEdges, landingConstellationPoints, landingSubjects } from './landingSystemData';
import type { LandingSubject, LandingView } from './landingSystemData';

export type LandingSystemSceneProps = {
  view: LandingView;
  selectedSubject: LandingSubject;
  onSelectSubject?: (subject: LandingSubject) => void;
};

export function LandingSystemScene({ view, selectedSubject, onSelectSubject }: LandingSystemSceneProps) {
  const headingId = useId();
  const detail = landingSubjects[selectedSubject];
  const selectProps = (subject: LandingSubject) => ({
    type: 'button' as const,
    'aria-pressed': selectedSubject === subject,
    onClick: () => onSelectSubject?.(subject),
  });
  return <div className="landing-system-scene" data-scene-view={view}>
    <figure className="scene-system" aria-labelledby={headingId}>
      <svg className="scene-constellation" data-scene-decoration aria-hidden="true" focusable="false" viewBox="0 0 730 400" preserveAspectRatio="none">
        {landingConstellationEdges.map(({ start, end }, index) => <line key={index} x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]} />)}
        {landingConstellationPoints.map(([x, y], index) => <circle key={index} cx={x} cy={y} r={index % 3 === 0 ? 2.4 : 1.5} />)}
      </svg>
      <figcaption className="scene-system-heading">
        <h2 id={headingId}>One System</h2>
        <span className="scene-example-label">Illustrative application</span>
      </figcaption>
      <div className="scene-board">
        <div className="scene-parts">
          <span className="scene-group-label">Composed Parts</span>
          <button {...selectProps('starter')} className="scene-card scene-starter" aria-label="Part: Astro starter">
            <span className="scene-part-icon" aria-hidden="true">✦</span>
            <span className="scene-card-title">Astro starter</span>
            <span className="scene-version">v1.2.0 pinned</span>
            <span className="scene-card-note">Routes + server</span>
          </button>
          <button {...selectProps('components')} className="scene-card scene-components" aria-label="Part: Component system">
            <span className="scene-component-glyph" aria-hidden="true"><i /><i /><i /><i /></span>
            <span className="scene-card-title">Component system</span>
            <span className="scene-version">v2.4.0 pinned</span>
            <span className="scene-override">Button override</span>
          </button>
        </div>
        <button {...selectProps('app')} className="scene-card scene-application" aria-label="Application: Fieldnotes">
          <span className="scene-window-bar"><span className="scene-window-dots" aria-hidden="true"><i /><i /><i /></span><span>Application</span><span className="scene-window-mark" aria-hidden="true">↗</span></span>
          <span className="scene-app-body">
            <span className="scene-app-title">Fieldnotes</span>
            <span className="scene-app-subtitle">Capture what you notice.</span>
            <span className="scene-record"><span className="scene-record-icon" aria-hidden="true" /><span>Morning by the lake<span className="scene-record-meta">A place worth returning to</span></span></span>
            <span className="scene-save">Save record<span aria-hidden="true">+</span></span>
            <span className="scene-app-status">{view === 'phenome' ? 'record.saved' : view === 'proteome' ? 'Interface realized' : 'Interface contract'}</span>
          </span>
        </button>
        <button {...selectProps('runtime')} className="scene-card scene-runtime" aria-label="Runtime: API and storage">
          <span className="scene-group-label">API + storage</span>
          <span className="scene-api"><span className="scene-runtime-glyph" aria-hidden="true">{'{ }'}</span><span className="scene-card-title">Records API</span><span className="scene-api-route">/api/records</span></span>
          <span className="scene-runtime-link"><span aria-hidden="true">↓</span> persists</span>
          <span className="scene-storage"><span className="scene-storage-glyph" aria-hidden="true"><i /><i /><i /></span><span className="scene-card-title">Record storage</span></span>
          <span className="scene-runtime-status">{view === 'phenome' ? 'GET /api/records 200' : view === 'proteome' ? 'Runtime R1' : 'Storage contract'}</span>
        </button>
      </div>
      <ul className="scene-relationships" aria-label="System relationships">
        <li><span className="scene-relationship-line" aria-hidden="true" />Parts compose the application</li>
        <li><span className="scene-relationship-line" aria-hidden="true" />Application calls API; API persists records</li>
      </ul>
      <div className="scene-provenance" aria-label="Distinct source, output and runtime identities">
        <span>source S1</span><span className="scene-provenance-arrow" aria-label="builds">→</span><span>output B1</span><span className="scene-provenance-arrow" aria-label="runs as">→</span><span>runtime R1</span>
      </div>
      <div className="scene-observation-slot">
        {view === 'phenome' ? <div className="scene-sample-metrics"><strong>Sample activity</strong><span>128 requests</span><span>p95 84 ms</span><span>0% errors</span></div> : <p className="scene-view-note">{view === 'genome' ? 'Declared shape + contracts' : 'Realized source + build'}</p>}
        <p className="scene-outcome">Outcome evidence: unmeasured</p>
      </div>
    </figure>
    <section className="scene-selected-detail" aria-label="Selected subject" aria-live="polite">
      <h3>{detail.title}</h3>
      <p>{detail.summary[view]}</p>
      <details key={selectedSubject}>
        <summary>Composition + provenance</summary>
        <p>{detail.detail}</p>
      </details>
    </section>
  </div>;
}
