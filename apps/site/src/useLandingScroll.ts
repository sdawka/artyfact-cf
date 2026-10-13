import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LandingView } from './landingSystemData';

/** Selects a view without owning navigation, focus or document scrolling. */
export function useLandingScroll(scene: RefObject<HTMLDivElement | null>, controls: RefObject<HTMLDivElement | null>, onView: (view: LandingView) => void) {
  const [pinned, setPinned] = useState(false);
  const [manual, setManual] = useState(false);
  const active = useRef<LandingView>('genome');
  const manualAt = useRef<LandingView | null>(null);
  const chooseView = useCallback((view: LandingView) => {
    manualAt.current = active.current;
    setManual(true);
    onView(view);
  }, [onView]);

  useEffect(() => {
    const element = scene.current;
    const buttons = controls.current;
    const story = element?.closest('#home-system-story');
    if (!element || !buttons || !story) return;
    const steps = [...story.querySelectorAll<HTMLElement>('[data-story-step]')];
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let alive = true;
    const measure = () => {
      frame = 0;
      if (!alive) return;
      const rect = element.getBoundingClientRect();
      const height = window.innerHeight;
      const desktop = window.innerWidth > 950;
      const top = desktop ? 24 : 16;
      const fits = desktop ? rect.height <= height - top * 2 : rect.height <= height * .45 && height - rect.height - 40 >= 240;
      const enabled = fits && !media.matches && rect.height > 0;
      setPinned(enabled);
      const line = desktop || rect.top > top + 1 ? height * .5 : rect.bottom + (height - rect.bottom) * .5;
      let next: LandingView = 'genome';
      for (const step of steps) if (step.getBoundingClientRect().top <= line) next = step.dataset.storyStep as LandingView;
      active.current = next;
      const keyboardFocus = element.contains(document.activeElement) && document.activeElement?.matches(':focus-visible');
      if (!enabled || keyboardFocus || manualAt.current === next) return;
      manualAt.current = null;
      setManual(false);
      onView(next);
    };
    const schedule = () => { if (!frame && alive) frame = requestAnimationFrame(measure); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    element.addEventListener('focusout', schedule);
    media.addEventListener('change', schedule);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resize?.observe(element);
    measure();
    return () => {
      alive = false;
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      element.removeEventListener('focusout', schedule);
      media.removeEventListener('change', schedule);
    };
  }, [scene, controls, onView]);
  return { pinned, manual, chooseView };
}
