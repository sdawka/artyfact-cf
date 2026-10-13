import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LandingView } from './landingSystemData';

const clamp = (value: number) => Math.min(1, Math.max(0, value));
/** Native scrolling supplies visual progress; React owns only semantic endpoints. */
export function useLandingScroll(scene: RefObject<HTMLDivElement | null>, controls: RefObject<HTMLDivElement | null>, onView: (view: LandingView) => void) {
  const [pinned, setPinned] = useState(false), [manual, setManual] = useState(false), [settled, setSettled] = useState(false);
  const active = useRef<LandingView>('genome'), selected = useRef<LandingView>('genome');
  const manualAt = useRef<LandingView | null>(null);
  const apply = useCallback((opening: number, realization: number, observation: number) => {
    const element = scene.current;
    if (!element) return;
    element.style.setProperty('--opening-progress', String(opening));
    element.style.setProperty('--realization-progress', String(realization));
    element.style.setProperty('--observation-progress', String(observation));
    element.dataset.phenomeSettled = String(observation === 1);
    element.dataset.openingSettled = String(opening === 1);
    element.dataset.realizationStarted = String(realization > 0);
    element.dataset.observationStarted = String(observation > 0);
    const chrome = [controls.current, element.querySelector<HTMLElement>('.scene-support')];
    for (const part of chrome) if (part) { part.inert = opening < 1; part.setAttribute('aria-hidden', String(opening < 1)); }
    // Opening is presentation, not a fourth ontology view; expose just its name/purpose.
    element.querySelector('.scene-opening')?.setAttribute('aria-hidden', String(opening === 1));
    for (const part of element.querySelectorAll('.scene-system-heading, .scene-board')) part.setAttribute('aria-hidden', String(opening < 1));
    setSettled(observation === 1);
  }, [scene, controls]);
  const endpoint = useCallback((view: LandingView) => apply(1, view === 'genome' ? 0 : 1, view === 'phenome' ? 1 : 0), [apply]);
  const chooseView = useCallback((view: LandingView) => {
    manualAt.current = active.current; selected.current = view;
    setManual(true); endpoint(view); onView(view);
  }, [endpoint, onView]);

  useEffect(() => {
    const element = scene.current, buttons = controls.current;
    const story = element?.closest('#home-system-story');
    if (!element || !buttons || !story) return;
    const stage = element.querySelector<HTMLElement>('.landing-sticky-stage') ?? element;
    const steps = [...story.querySelectorAll<HTMLElement>('[data-story-step]')];
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let frame = 0, alive = true, pointerDemoFocus = false;
    element.dataset.enhanced = 'true';
    const measure = () => {
      frame = 0;
      if (!alive) return;
      const rect = stage.getBoundingClientRect(), height = window.innerHeight;
      const desktop = window.innerWidth > 950, top = desktop ? 24 : 16;
      const fits = desktop ? rect.height <= height - top * 2 : rect.height <= height - 32 - 176;
      const enabled = fits && !media?.matches && rect.height > 0;
      setPinned(enabled);
      const line = desktop ? height * .5 : top + rect.height + Math.max(0, height - top - rect.height) * .5;
      const positions = steps.map(step => step.getBoundingClientRect().top);
      let next: LandingView = 'genome';
      for (let index = 0; index < steps.length; index++) if (positions[index] <= line) next = steps[index].dataset.storyStep as LandingView;
      active.current = next;
      const keyboardFocus = element.contains(document.activeElement) && document.activeElement?.matches(':focus-visible');
      // Both pixels and semantics freeze, so a focused control remains visible.
      if (media?.matches) { endpoint(selected.current); return; }
      const pointerFocus = pointerDemoFocus && element.contains(document.activeElement) && document.activeElement?.matches('button.scene-save, button.scene-demo-control');
      if (!pointerFocus) pointerDemoFocus = false;
      if (keyboardFocus || pointerFocus || manualAt.current === next) return;
      if (!enabled) { endpoint(selected.current); return; }
      manualAt.current = null; setManual(false);
      selected.current = next; onView(next);
      const [genome, proteome, phenome] = positions;
      // On mobile, wait until the whole compact stage is readable before morphing.
      const openingStart = desktop ? 0 : Math.max(0, genome + window.scrollY - height + 24);
      const openingEnd = genome + window.scrollY - line;
      if (positions.length === 3) apply(clamp((window.scrollY - openingStart) / Math.max(1, openingEnd - openingStart)), clamp((line - genome) / Math.max(1, proteome - genome)), clamp((line - proteome) / Math.max(1, phenome - proteome)));
    };
    const schedule = () => { if (!frame && alive) frame = requestAnimationFrame(measure); };
    const demoTarget = (target: EventTarget | null) => target instanceof Element && element.contains(target) && !!target.closest('button.scene-save, button.scene-demo-control');
    const focus = (event: FocusEvent) => {
      const target = event.type === 'focusout' ? event.relatedTarget : event.target;
      pointerDemoFocus = demoTarget(target) && target instanceof Element && !target.matches(':focus-visible');
      schedule();
    };
    const pointer = (event: PointerEvent) => { if (event.isPrimary && event.button === 0 && demoTarget(event.target)) pointerDemoFocus = true; };
    const scrollIntent = () => { pointerDemoFocus = false; schedule(); };
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    window.addEventListener('wheel', scrollIntent, { passive: true }); window.addEventListener('touchmove', scrollIntent, { passive: true });
    element.addEventListener('focusin', focus); element.addEventListener('focusout', focus); element.addEventListener('pointerdown', pointer); media?.addEventListener('change', schedule);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(stage); measure();
    return () => {
      alive = false; if (frame) cancelAnimationFrame(frame); resize?.disconnect();
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', scrollIntent); window.removeEventListener('touchmove', scrollIntent);
      element.removeEventListener('focusin', focus); element.removeEventListener('focusout', focus); element.removeEventListener('pointerdown', pointer); media?.removeEventListener('change', schedule);
    };
  }, [scene, controls, onView, apply, endpoint]);
  return { pinned, manual, settled, chooseView };
}
