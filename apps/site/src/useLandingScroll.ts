import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LandingView } from './landingSystemData';
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const views: LandingView[] = ['genome', 'proteome', 'phenome'];
type Pose = { opening: number; realization: number; observation: number; agent: number; arrow: number };
const poseFor = (view: LandingView): Pose => ({ opening: 1, realization: view === 'genome' ? 0 : 1, observation: view === 'phenome' ? 1 : 0, agent: view === 'genome' ? 0 : 1, arrow: view === 'genome' ? 0 : 1 });
const opening: Pose = { opening: 0, realization: 0, observation: 0, agent: 0, arrow: 0 };
/** Native scroll accepts chapters; finite, interruptible motion settles their artwork. */
export function useLandingScroll(scene: RefObject<HTMLDivElement | null>, controls: RefObject<HTMLDivElement | null>, onView: (view: LandingView) => void) {
  const [pinned, setPinned] = useState(false), [manual, setManual] = useState(false), [settled, setSettled] = useState(false);
  const active = useRef<LandingView>('genome'), selected = useRef<LandingView>('genome');
  const manualAt = useRef<LandingView | null>(null), pose = useRef<Pose>(poseFor('genome'));
  const cancel = useRef<() => void>(() => {});
  const apply = useCallback((value: Pose) => {
    pose.current = value; const element = scene.current; if (!element) return;
    for (const [key, progress] of Object.entries(value)) element.style.setProperty('--' + key + '-progress', String(progress));
    element.dataset.phenomeSettled = String(value.observation === 1);
    element.dataset.openingSettled = String(value.opening === 1);
    element.dataset.realizationStarted = String(value.agent > 0);
    element.dataset.observationStarted = String(value.observation > 0);
    if (controls.current) { controls.current.inert = value.opening < 1; controls.current.setAttribute('aria-hidden', String(value.opening < 1)); }
    element.querySelector('.scene-opening')?.setAttribute('aria-hidden', String(value.opening === 1));
    for (const part of element.querySelectorAll('.scene-system-heading, .scene-board')) part.setAttribute('aria-hidden', String(value.opening < 1));
    setSettled(value.observation === 1);
  }, [scene, controls]);
  const endpoint = useCallback((view: LandingView) => { cancel.current(); apply(poseFor(view)); if (scene.current) scene.current.dataset.motion = 'settled'; }, [apply]);
  const chooseView = useCallback((view: LandingView) => {
    manualAt.current = active.current; selected.current = view; setManual(true); endpoint(view); onView(view);
  }, [endpoint, onView]);
  useEffect(() => {
    const element = scene.current, buttons = controls.current, story = element?.closest('#home-system-story');
    if (!element || !buttons || !story) return;
    const stage = element.querySelector<HTMLElement>('.landing-sticky-stage') ?? element;
    const steps = [...story.querySelectorAll<HTMLElement>('[data-story-step]')];
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let frame = 0, motion = 0, alive = true, pointerDemoFocus = false, accepted = -1, initialized = false;
    let destination: Pose | null = null;
    cancel.current = () => { if (motion) cancelAnimationFrame(motion); motion = 0; destination = null; };
    element.dataset.enhanced = 'true';
    const animate = (target: Pose, view: LandingView) => {
      if (destination && Object.keys(target).every(key => target[key as keyof Pose] === destination?.[key as keyof Pose])) return;
      cancel.current();
      if (Object.keys(target).every(key => target[key as keyof Pose] === pose.current[key as keyof Pose])) { element.dataset.motion = 'settled'; return; }
      destination = target; const from = { ...pose.current }, start = performance.now();
      const realizes = from.realization !== target.realization;
      const duration = realizes ? 720 : 480;
      const tick = () => {
        if (!alive) return; const elapsed = performance.now() - start;
        const next = { ...from };
        for (const key of Object.keys(target) as (keyof Pose)[]) {
          let offset = 0, length = duration;
          if (realizes && target.realization === 1) {
            if (key === 'agent') length = 220;
            if (key === 'arrow') { offset = 140; length = 280; }
            if (key === 'realization') { offset = 380; length = 340; }
          } else if (realizes) {
            if (key === 'realization') length = 340;
            if (key === 'arrow') { offset = 240; length = 280; }
            if (key === 'agent') { offset = 500; length = 220; }
          }
          const t = clamp((elapsed - offset) / length), eased = 1 - (1 - t) ** 3;
          next[key] = from[key] + (target[key] - from[key]) * eased;
        }
        apply(next);
        if (elapsed < duration) motion = requestAnimationFrame(tick);
        else { motion = 0; destination = null; apply(target); element.dataset.motion = 'settled'; }
      };
      element.dataset.motion = 'settling'; element.dataset.motionTarget = view; motion = requestAnimationFrame(tick);
    };
    const measure = () => {
      frame = 0; if (!alive) return;
      const rect = stage.getBoundingClientRect(), height = window.innerHeight;
      const desktop = window.innerWidth > 950, top = desktop ? 24 : 16;
      const readingHeight = desktop ? height - top * 2 : Math.max(0, height - top - rect.height);
      const enabled = (desktop ? rect.height <= height - top * 2 : rect.height <= height - 32 - 176) && !media?.matches && rect.height > 0;
      setPinned(enabled);
      const line = desktop ? height * .5 : top + rect.height + readingHeight * .5;
      const positions = steps.map(step => (step.querySelector<HTMLElement>('[data-story-heading]') ?? step).getBoundingClientRect().top);
      let next = accepted;
      const band = Math.max(24, Math.min(64, readingHeight * .12));
      while (next < steps.length - 1 && positions[next + 1] <= line) next++;
      while (next >= 0 && positions[next] > line + band) next--;
      active.current = views[Math.max(0, next)] ?? 'genome';
      const keyboardFocus = element.contains(document.activeElement) && document.activeElement?.matches(':focus-visible');
      const pointerFocus = pointerDemoFocus && element.contains(document.activeElement) && document.activeElement?.matches('button.scene-save, button.scene-demo-control');
      if (!pointerFocus) pointerDemoFocus = false;
      // Focus protects the accepted chapter; settle it, rather than stranding half an animation.
      if (media?.matches || keyboardFocus || pointerFocus) { endpoint(selected.current); return; }
      if (manualAt.current === active.current) return;
      if (!enabled) { endpoint(selected.current); return; }
      manualAt.current = null; setManual(false); accepted = next;
      const view = views[Math.max(0, next)] ?? 'genome'; selected.current = view; onView(view);
      const target = next < 0 ? opening : poseFor(view);
      if (!initialized || document.visibilityState === 'hidden' || rect.bottom <= 0 || rect.top >= height) { cancel.current(); apply(target); }
      else animate(target, view);
      initialized = true;
    };
    const schedule = () => { if (!frame && alive) frame = requestAnimationFrame(measure); };
    const demoTarget = (target: EventTarget | null) => target instanceof Element && element.contains(target) && !!target.closest('button.scene-save, button.scene-demo-control');
    const focus = (event: FocusEvent) => {
      const target = event.type === 'focusout' ? event.relatedTarget : event.target;
      pointerDemoFocus = demoTarget(target) && target instanceof Element && !target.matches(':focus-visible'); schedule();
    };
    const pointer = (event: PointerEvent) => { if (event.isPrimary && event.button === 0 && demoTarget(event.target)) pointerDemoFocus = true; };
    const scrollIntent = () => { pointerDemoFocus = false; schedule(); };
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    window.addEventListener('wheel', scrollIntent, { passive: true }); window.addEventListener('touchmove', scrollIntent, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    element.addEventListener('focusin', focus); element.addEventListener('focusout', focus); element.addEventListener('pointerdown', pointer); media?.addEventListener('change', schedule);
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule); resize?.observe(stage); measure();
    return () => {
      alive = false; if (frame) cancelAnimationFrame(frame); cancel.current(); resize?.disconnect();
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', scrollIntent); window.removeEventListener('touchmove', scrollIntent); document.removeEventListener('visibilitychange', schedule);
      element.removeEventListener('focusin', focus); element.removeEventListener('focusout', focus); element.removeEventListener('pointerdown', pointer); media?.removeEventListener('change', schedule);
    };
  }, [scene, controls, onView, apply, endpoint]);
  return { pinned, manual, settled, chooseView };
}
