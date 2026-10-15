import React from 'react';
import { disciplines, practices, relationLabels } from './practiceStackData';

/** Static: every row is readable without CSS or JavaScript. Each discipline is a native disclosure, open in the markup;
 * the client closes all but the first on narrow screens. Labels and words carry the meaning, never colour. */
export function PracticeStack() {
  return <section className="section practice-stack" id="practices" aria-labelledby="practice-stack-heading">
    <div className="section-heading"><h2 id="practice-stack-heading">The practices you already use, connected and taken further.</h2><p>A product is shaped by many roles, continuously. Artyfact keeps the practices each of them already uses and ties every one to the same model of your product. Some are built in, some are extended, and some connect what you already write.</p></div>
    {disciplines.map((discipline, index) => {
      const rows = practices.filter(practice => practice.discipline === discipline);
      return <details key={discipline} className="practice-group" open data-collapse-below="780" data-keep-open={index === 0 ? '' : undefined}>
        <summary><span className="practice-group-name">{discipline}</span><span className="practice-group-count">{rows.length} practices</span></summary>
        <p className="practice-cols" aria-hidden="true"><span>You know</span><span>In Artyfact</span><span>Status</span></p>
        <ul className="practice-list">
          {rows.map(practice => <li key={practice.known} className="practice-row" data-status={practice.status} data-relation={practice.relation}>
            <p className="practice-known"><span className="sr-only">You know: </span>{practice.known}</p>
            <div className="practice-what">
              <p className="practice-artyfact"><span className="sr-only">In Artyfact: </span>{practice.artyfact}</p>
              {(practice.term || practice.link) && <p className="practice-meta">{practice.term && <span className="term-label">{practice.term}</span>}{practice.link && <a className="text-link practice-link" href={practice.link.href}>{practice.link.label}</a>}</p>}
            </div>
            <p className="practice-state"><span className="relation-tag">{relationLabels[practice.relation]}</span>{practice.note && <span className="practice-note">{practice.note}</span>}</p>
          </li>)}
        </ul>
      </details>;
    })}
  </section>;
}
