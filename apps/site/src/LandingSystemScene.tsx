import React, { useId } from 'react';
import { landingIdeas, landingSubjects } from './landingSystemData';
import type { LandingDemo, LandingSubject, LandingView } from './landingSystemData';

export type LandingSystemSceneProps = {
  view: LandingView;
  selectedSubject: LandingSubject;
  onSelectSubject?: (subject: LandingSubject) => void;
  demo?: LandingDemo;
};
const emptyDemo: LandingDemo = { count: 0, pressing: false, showPointer: false, celebrating: false, showToast: false, paused: false, completed: false, onSave: () => {}, onPause: () => {}, onResume: () => {} };
const confettiPieces = Array.from({ length: 18 }, (_, index) => index);
const ideaFor = (count: number) => landingIdeas[Math.max(0, Math.floor(count)) % landingIdeas.length];

/** Visual-only frame. Story places support content in ordinary document flow. */
export function LandingSystemScene({ view, selectedSubject, demo = emptyDemo }: LandingSystemSceneProps) {
  const headingId = useId();
  const shape = view === 'genome';
  const active = view === 'phenome';
  const idea = ideaFor(demo.count);
  const chartLevel = Math.min(12, Math.max(0, demo.count));
  return <div className="landing-system-scene scene-visual" data-scene-view={view}>
        <div className="scene-external-lane">
          <div className="scene-coding-agent" role="img" aria-label="Coding agents realize the declared application" aria-hidden={view !== 'proteome'}>
            <span className="scene-agent-label">Coding agents</span>
            <svg className="scene-computer" aria-hidden="true" focusable="false" viewBox="0 0 100 76"><rect x="13" y="3" width="74" height="50" rx="4" /><path className="scene-code-lines" d="m30 20-8 7 8 7m40-14 8 7-8 7m-14-17-8 22" /><path d="M13 57h74l10 12H3z" /><path d="M38 64h24" /></svg>
            <svg className="scene-realization-arrow" aria-hidden="true" focusable="false" viewBox="0 0 100 20"><path pathLength="100" d="M2 10h92m-9-7 9 7-9 7" /></svg>
          </div>
          <div className="scene-save-chart" role="img" aria-label={`Ideas explored: ${demo.count}. Bar shown up to 12 ideas.`} aria-hidden={!active}>
            <span className="scene-chart-caption">Ideas explored</span>
            <div className="scene-chart-plot"><div className="scene-chart-ticks" aria-hidden="true"><span>12+</span><span>6</span><span>0</span></div><div className="scene-chart-track" aria-hidden="true"><div className="scene-chart-bar" data-chart-level={chartLevel} /></div></div>
            <strong>{demo.count} {demo.count === 1 ? 'idea' : 'ideas'}</strong>
          </div>
        </div>
    <figure className="scene-system" aria-labelledby={headingId}>
      <div className="scene-opening" aria-hidden="true"><strong>Artyfact</strong><p>Turn ideas into meaningful systems.</p></div>
      <figcaption className="scene-system-heading"><h2 id={headingId}>Artyfact</h2><span className="scene-example-label">Illustrative example</span></figcaption>
      <div className="scene-board">
        <article className="scene-card scene-application" aria-label="Application: Artyfact" data-selected={selectedSubject === 'app'}>
          <div className="scene-app-heading" aria-hidden={!shape}>Application</div>
          <div className="scene-app-body scene-app-shape" aria-hidden={!shape}>
            <div className="scene-name-slot scene-shape-slot"><span>System name</span></div>
            <div className="scene-purpose-slot scene-shape-slot"><span>Purpose</span></div>
            <div className="scene-action-slot scene-shape-slot"><span>Explore another idea</span></div>
          </div>
          <div className="scene-realized-app" aria-hidden={shape}>
            <div className="scene-app-heading"><span>Application</span>{active && <button type="button" className="scene-demo-control" data-demo-resume={demo.paused || demo.completed ? '' : undefined} aria-disabled={demo.completed || undefined} onClick={demo.completed ? undefined : demo.paused ? demo.onResume : demo.onPause}>{demo.completed ? 'Auto demo complete' : demo.paused ? 'Resume demo' : 'Pause demo'}</button>}</div>
            <div className="scene-app-body">
              <div className="scene-name-slot scene-shape-slot"><span className="scene-output-label">System name</span><span className="scene-output-name" aria-label="Current System name">{idea.name}</span></div>
              <div className="scene-purpose-slot scene-shape-slot"><span className="scene-output-label">Purpose</span><span className="scene-output-purpose" aria-label="Current Purpose">{idea.purpose}</span></div>
              <div className="scene-action-slot">{active ? <button type="button" className="scene-save" data-pressing={demo.pressing} onClick={demo.onSave}>Randomize</button> : <span className="scene-save scene-save-preview">Randomize</span>}
                {active && demo.showPointer && <svg className="scene-demo-pointer" data-demo-pointer aria-hidden="true" focusable="false" viewBox="0 0 26 32"><path d="M3 2 22 20l-10 1-4 9Z" /></svg>}
                {active && demo.pressing && <span className="scene-button-pulse" aria-hidden="true" />}
              </div>
            </div>
          </div>
          {active && demo.celebrating && <div className="scene-confetti" data-scene-confetti aria-hidden="true">{confettiPieces.map(index => <i key={index} />)}</div>}
        </article>
        <article className="scene-runtime" aria-label="Runtime: API and storage" data-selected={selectedSubject === 'runtime'}>
          <div className="scene-runtime-shape" aria-hidden={!shape}><div className="scene-api scene-shape-slot"><span>Ideas API</span></div><span className="scene-runtime-link" aria-hidden="true">→</span><div className="scene-storage scene-shape-slot"><span>Idea storage</span></div></div>
          <div className="scene-runtime-realized" aria-hidden={shape}><div className="scene-api scene-shape-slot"><span>Ideas API</span><code>/api/ideas</code></div><span className="scene-runtime-link">→</span><div className="scene-storage scene-shape-slot"><span>Idea storage</span><span className="scene-storage-lines"><i /><i /><i /></span></div></div>
        </article>
      </div>
    </figure>
  </div>;
}

/** Composition, history and inspection stay outside the sticky visual. */
export function LandingSystemSupport({ view, selectedSubject, onSelectSubject, demo = emptyDemo }: LandingSystemSceneProps) {
  const detail = landingSubjects[selectedSubject];
  const selectProps = (subject: LandingSubject) => ({ type: 'button' as const, 'aria-pressed': selectedSubject === subject, onClick: () => onSelectSubject?.(subject) });
  const hasIdeas = demo.count > 0;
  const recent = Array.from({ length: Math.min(3, Math.max(0, demo.count)) }, (_, index) => ideaFor(demo.count - index));
  return <div className="landing-system-scene scene-support" data-support-view={view}>
    <section className="scene-conclusion"><div><h2>Start with a purpose.<br />Keep it in the work.</h2><div className="scene-current-idea"><small>Illustrative idea</small><strong>{ideaFor(demo.count).name}</strong><p>{ideaFor(demo.count).purpose}</p></div></div><div className="prose"><p>An agent needs to know why a change matters, whose needs it serves, and what must stay true.</p><p>Artyfact gives that context a home: a <a href="/model">System</a>, the context and governance wrapper around one or more Things. A single Thing can be a whole application and begin with its Genome alone.</p><p>Keep in Touch, the separate example on our model page, explores another purpose. The purpose is more wanted contact with people you choose. Private notes, consent and a calm experience follow from that purpose.</p></div></section>
    <div className="scene-support-inspection">
    <div className="scene-feedback-slot">{view === 'phenome' && demo.showToast && <p className="scene-demo-toast" role="status" aria-live="polite">Great energy!</p>}</div>
    <div className="scene-composition-rail" aria-label="Composed Parts"><span>Parts</span><button {...selectProps('starter')} aria-label="Part: Astro starter">Astro starter</button><span aria-hidden="true">+</span><button {...selectProps('components')} aria-label="Part: Component system">Component system</button><span className="scene-composition-target">compose this app</span></div>
    <div className="scene-inspection-controls"><button {...selectProps('app')} aria-label="Inspect Artyfact application">Application</button><button {...selectProps('runtime')} aria-label="Inspect API and storage">API + storage</button></div>
    <section className="scene-selected-detail" aria-label="Selected subject"><h3>{detail.title}</h3><p>{detail.summary[view]}</p><details key={selectedSubject}><summary>Composition + provenance</summary><p>{detail.detail}</p><p>Parts compose the application. Application calls API; API persists ideas.</p><p>Outcome evidence: unmeasured.</p></details></section>
    <section className="scene-recent-ideas" hidden={!hasIdeas}>{hasIdeas && <><h3>Recent ideas</h3><ul aria-label="Recent ideas">{recent.map((idea, index) => <li key={demo.count - index}><strong>{idea.name}</strong><span>{idea.purpose}</span></li>)}</ul></>}</section>
    </div>
  </div>;
}
