import React from 'react';
import { disciplines, practices, relationLabels } from './practiceStackData';

/** Static: every card is readable without CSS or JavaScript. The arrow is decorative; the labels carry the meaning. */
export function PracticeStack() {
  return <section className="section practice-stack" aria-labelledby="practice-stack-heading">
    <div className="section-heading"><h2 id="practice-stack-heading">The practices you already use, connected and taken further.</h2><p>Today they live in separate tools and files. Artyfact keeps them and ties each one to the same model of your product. Some are built in, some are extended, and some connect what you already write.</p></div>
    <p className="practice-legend" aria-hidden="true"><span>You know</span><PracticeArrow /><span>In Artyfact</span></p>
    {disciplines.map(discipline => <div key={discipline} className="practice-group">
      <h3>{discipline}</h3>
      <ul className="practice-list">
        {practices.filter(practice => practice.discipline === discipline).map(practice => <li key={practice.known} className="practice-card" data-status={practice.status} data-relation={practice.relation}>
          <p className="practice-known"><span className="sr-only">You know: </span>{practice.known}</p>
          <PracticeArrow />
          <p className="practice-artyfact"><span className="sr-only">In Artyfact: </span>{practice.artyfact}</p>
          <p className="practice-meta"><span className="relation-tag">{relationLabels[practice.relation]}</span>{practice.term && <span className="term-label">{practice.term}</span>}{practice.note && <span className="practice-note">{practice.note}</span>}{practice.link && <a className="text-link practice-link" href={practice.link.href}>{practice.link.label}</a>}</p>
        </li>)}
      </ul>
    </div>)}
  </section>;
}
function PracticeArrow() {
  return <svg className="practice-arrow" viewBox="0 0 40 18" width="40" height="18" aria-hidden="true" focusable="false"><path d="M2 3v4a4 4 0 0 0 4 4h30M31 6.5l4.5 4.5-4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" pathLength={1} /></svg>;
}
