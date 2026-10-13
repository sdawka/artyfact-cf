import React, { useRef, useState } from 'react';
import { LandingSystemScene } from './LandingSystemScene';
import type { LandingSubject, LandingView } from './landingSystemData';
import { useLandingScroll } from './useLandingScroll';

const views: { id: LandingView; name: string; meaning: string }[] = [
  { id: 'genome', name: 'Genome', meaning: 'The shape' },
  { id: 'proteome', name: 'Proteome', meaning: 'The application' },
  { id: 'phenome', name: 'Phenome', meaning: 'The activity' },
];

/** Home-only illustration. The model page keeps its ordinary explorer and selection contract. */
export function LandingStory() {
  const [view, setView] = useState<LandingView>('genome');
  const [subject, setSubject] = useState<LandingSubject>('app');
  const scene = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const { pinned, manual, chooseView } = useLandingScroll(scene, controls, setView);
  return <div ref={scene} className="landing-story-controller" data-system-view={view} data-sticky={String(pinned)} data-scroll-mode={pinned ? manual ? 'manual' : 'following' : 'static'}>
    <div ref={controls} className="landing-view-controls" role="tablist" aria-label="Views of the same System">
      {views.map((item, index) => <button key={item.id} id={'landing-view-' + item.id} role="tab" aria-controls="landing-system-panel" aria-selected={view === item.id} tabIndex={view === item.id ? 0 : -1}
        onClick={() => chooseView(item.id)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next !== null) { event.preventDefault(); chooseView(views[next].id); (event.currentTarget.parentElement?.children[next] as HTMLButtonElement)?.focus(); }
        }}><span>{item.name}</span><small>{item.meaning}</small></button>)}
    </div>
    <div id="landing-system-panel" role="tabpanel" aria-labelledby={'landing-view-' + view}><LandingSystemScene view={view} selectedSubject={subject} onSelectSubject={setSubject} /></div>
    <p className="landing-story-instruction">Three views of the same System. {pinned ? manual ? 'Your choice stays until the next description.' : 'Scroll to explore, or choose a view.' : 'Choose a view; read its description below.'}</p>
  </div>;
}
