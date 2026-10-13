import React, { useEffect, useRef, useState } from 'react';
import { LandingSystemScene, LandingSystemSupport } from './LandingSystemScene';
import type { LandingSubject, LandingView } from './landingSystemData';
import { useLandingScroll } from './useLandingScroll';
import { useLandingDemo } from './useLandingDemo';

const views: { id: LandingView; name: string; meaning: string }[] = [
  { id: 'genome', name: 'Genome', meaning: 'The shape' },
  { id: 'proteome', name: 'Proteome', meaning: 'The application' },
  { id: 'phenome', name: 'Phenome', meaning: 'The activity' },
];

/** Home-only illustration. The model page keeps its ordinary explorer and selection contract. */
export function LandingStory({ platform }: { platform?: string | null } = {}) {
  const [view, setView] = useState<LandingView>('genome');
  const [subject, setSubject] = useState<LandingSubject>('app');
  const scene = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const { pinned, manual, settled, chooseView } = useLandingScroll(scene, controls, setView);
  const demo = useLandingDemo(scene, view, settled);
  useEffect(() => {
    const targets=[...document.querySelectorAll<HTMLElement>('.workflow-list li, .closing')];
    if (typeof IntersectionObserver==='undefined') { for(const target of targets) target.dataset.revealed='true'; return; }
    const observer=new IntersectionObserver(entries=>{ for(const entry of entries) if(entry.isIntersecting) { (entry.target as HTMLElement).dataset.revealed='true'; observer.unobserve(entry.target); } },{threshold:.35});
    for(const target of targets) observer.observe(target); return()=>observer.disconnect();
  },[]);
  return <div ref={scene} className="landing-story-controller" data-system-view={view} data-sticky={String(pinned)} data-scroll-mode={pinned ? manual ? 'manual' : 'following' : 'static'}>
    <div className="landing-story-scroll-region">
      <div className="hero-copy"><h1>Make Meaningful<br /> Systems</h1><p className="cloudflare-line">(on Cloudflare)</p><p className="lead">Give your agent the whole picture.</p><p>Bring an ontology or build one with your agent. Connect intention to files and folders, agree on what changes, and coordinate the work around the same System.</p><div className="actions"><a className="button primary u-brackets" href="/connect-agent">Bring your agent</a><a className="text-link" href="/model#lifecycle">Explore the workflow</a></div>{platform ? <a className="button u-brackets" href={platform}>Open the platform</a> : <p className="availability"><span className="availability-mark" aria-hidden="true" />The hosted handoff is being prepared. The guide is ready.</p>}</div>
    <div className="landing-sticky-stage"><div ref={controls} className="landing-view-controls" role="tablist" aria-label="Views of the same System">
      {views.map((item, index) => <button key={item.id} id={'landing-view-' + item.id} role="tab" aria-controls="landing-system-panel" aria-selected={view === item.id} tabIndex={view === item.id ? 0 : -1}
        onClick={() => chooseView(item.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next !== null) { event.preventDefault(); chooseView(views[next].id); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }
        }}><span>{item.name}</span><small>{item.meaning}</small></button>)}
    </div>
    <div id="landing-system-panel" role="tabpanel" aria-labelledby={'landing-view-' + view}><LandingSystemScene view={view} selectedSubject={subject} onSelectSubject={setSubject} demo={demo} /></div></div>

      <article className="story-step" id="genome-shape" data-story-step="genome"><div data-story-heading=""><p className="story-view-name">Genome · The shape</p><h2>Give the application its shape.</h2><p>This miniature Artyfact explores sample system ideas: a name, a purpose and the shape of an idea generator. Start with the people it serves, what it should do and what must stay true. Screens, routes and private data take a recognizable shape before they need implementation.</p><p className="story-detail">A Thing can begin with its Genome alone. Parts and source are optional.</p></div></article>
      <article className="story-step" id="proteome-application" data-story-step="proteome"><div data-story-heading=""><p className="story-view-name">Proteome · The application</p><h2>Make that shape tangible.</h2><p>Outside coding agents realize the declared shape. An illustrative Astro starter and component system contribute to the same application. Its screen, API and storage become solid, while the System keeps track of how they were realized and checked.</p><p className="story-detail">The recipe explicitly replaces the starter Button and adapts callers and configuration. Authored source and each realized output keep separate identities.</p></div></article>
      <article className="story-step" id="phenome-activity" data-story-step="phenome"><div data-story-heading=""><p className="story-view-name">Phenome · The activity</p><h2>See what happens when it functions.</h2><p>Events and metrics sit beside the application they describe. Randomize a sample system name and purpose, then see the local idea count grow beside the interface that produced it.</p><p className="story-detail">Activity here is illustrative. The curated ideas are a local demonstration, without AI generation, real requests or saved data. Useful outcomes remain unmeasured; functioning alone does not establish purpose.</p></div></article>
    </div>
    <LandingSystemSupport view={view} selectedSubject={subject} onSelectSubject={setSubject} demo={demo} />
    <p className="landing-story-instruction">Three views of the same System. {pinned ? manual ? 'Your choice stays until the next description.' : 'Scroll to explore, or choose a view.' : 'Choose a view; read its description below.'}</p>
  </div>;
}
