import React from 'react';

const beats = [
  { title: 'A product is alive.', body: 'Taken together with the people who build and use it, software behaves like a living thing made of ideas. It copies, adapts and gets selected. It is never finished, so its model never is either.', link: { href: '#home-system-story', label: 'See one change go around' } },
  { title: 'Many hands, all the time.', body: 'Product, design, engineering, data and operations keep shaping it, before launch and long after, all from the same model.', link: { href: '#practices', label: 'See the practices it connects' } },
  { title: 'Rails and room.', body: 'Agents drift without limits and stall with too many. The platform has to strike the balance.', link: { href: '#environment', label: 'How agents thrive here' } },
  { title: 'The theory decides. The code translates.', body: 'Once the model says where and what must change, writing the code is mostly translation. Simple Tasks can go to cheaper models, even ones on your own machine.', link: { href: '/connect-agent#work', label: 'What your agent works from' } },
] as const;

const views = [
  { term: 'Genome', label: 'What it should be', body: 'The theory and ontology of your product: purposes, people, journeys, rules, and how you would know they hold.' },
  { term: 'Proteome', label: 'What is being made', body: 'Your agents and the code they write, turning the Genome into something you can deploy.' },
  { term: 'Phenome', label: 'What it does', body: 'The running product, observed and measured, tied back to the commit and the model.' },
] as const;

/** Static: the argument of the page in four beats, each pointing to the section that shows it, then the three views of one model. */
export function Thesis() {
  return <section className="section thesis" id="thesis" aria-labelledby="thesis-heading">
    <div className="section-heading"><h2 id="thesis-heading">Files are information. Your product is meaning.</h2><p>Git records what changed. Artyfact also records why: who it is for, what it should do, and how you would know it worked.</p></div>
    <ul className="thesis-beats">
      {beats.map(beat => <li key={beat.title}><article><h3>{beat.title}</h3><p>{beat.body}</p><a className="text-link" href={beat.link.href}>{beat.link.label}</a></article></li>)}
    </ul>
    <ol className="thesis-views" aria-label="Three views of one model">
      {views.map(view => <li key={view.term}><h3><span className="term-label">{view.term}</span>{view.label}</h3><p>{view.body}</p></li>)}
    </ol>
    <p className="thesis-links"><a className="text-link" href="/model#model-parallel-views">Open the three views</a></p>
  </section>;
}
