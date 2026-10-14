import React from 'react';
import { disciplines, practices } from './practiceStackData';

/** Static: every card is readable without CSS or JavaScript; the struck practice is real text. */
export function PracticeStack() {
  return <section className="section practice-stack" aria-labelledby="practice-stack-heading">
    <div className="section-heading"><h2 id="practice-stack-heading">Stop stitching these together.</h2><p>You already use these practices. Today they live in separate tools and files. Artyfact does each one in one place, tied to the same model of your product.</p></div>
    {disciplines.map(discipline => <div key={discipline} className="practice-group">
      <h3>{discipline}</h3>
      <ul className="practice-list">
        {practices.filter(practice => practice.discipline === discipline).map(practice => <li key={practice.replaces} className="practice-card" data-status={practice.status}>
          <s>{practice.replaces}</s>
          <p>{practice.artyfact}</p>
          {(practice.term || practice.note) && <p className="practice-meta">{practice.term && <span className="term-label">{practice.term}</span>}{practice.note && <span className="practice-note">{practice.note}</span>}</p>}
        </li>)}
      </ul>
    </div>)}
  </section>;
}
