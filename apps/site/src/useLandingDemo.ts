import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LandingDemo, LandingView } from './landingSystemData';

type Environment = { onScreen: boolean; visible: boolean; reduced: boolean; keyboard: boolean };
type TimerName = 'auto' | 'press' | 'celebration' | 'toast';

/** One page-local demonstration; view changes never reset its progress or earned celebration. */
export function useLandingDemo(scene: RefObject<HTMLDivElement | null>, view: LandingView): LandingDemo {
  const [count, setCount] = useState(0);
  const [manual, setManual] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [environment, setEnvironment] = useState<Environment>({ onScreen: false, visible: false, reduced: false, keyboard: false });
  const latest = useRef({ view, environment });
  latest.current = { view, environment };
  const progress = useRef(0), manualStarted = useRef(false), celebrated = useRef(false), automaticPress = useRef(false);
  const timers = useRef<Partial<Record<TimerName, number>>>({});
  const clear = useCallback((name: TimerName) => { window.clearTimeout(timers.current[name]); delete timers.current[name]; }, []);

  useEffect(() => {
    const root = scene.current;
    if (!root) return;
    let alive = true;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const update = (patch: Partial<Environment>) => { if (alive) setEnvironment(previous => ({ ...previous, ...patch })); };
    const focus = (event?: FocusEvent) => { const target = event?.type === 'focusout' ? event.relatedTarget : document.activeElement; update({ keyboard: target instanceof Element && root.contains(target) && target.matches(':focus-visible') }); };
    const visibility = () => update({ visible: document.visibilityState !== 'hidden' });
    const preference = () => update({ reduced: !!media?.matches });
    const target = root.querySelector('.scene-system') ?? root;
    const measure = () => { const rect = target.getBoundingClientRect(); update({ onScreen: rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 }); };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => update({ onScreen: entries.some(entry => entry.isIntersecting) }));
    observer?.observe(target);
    if (!observer) { window.addEventListener('scroll', measure, { passive: true }); window.addEventListener('resize', measure); }
    root.addEventListener('focusin', focus); root.addEventListener('focusout', focus);
    document.addEventListener('visibilitychange', visibility); media?.addEventListener('change', preference);
    focus(); visibility(); preference(); measure();
    return () => {
      alive = false; observer?.disconnect();
      window.removeEventListener('scroll', measure); window.removeEventListener('resize', measure);
      root.removeEventListener('focusin', focus); root.removeEventListener('focusout', focus);
      document.removeEventListener('visibilitychange', visibility); media?.removeEventListener('change', preference);
    };
  }, [scene]);

  const recordSave = useCallback((byVisitor: boolean) => {
    const current = latest.current;
    if (current.view !== 'phenome') return;
    if (byVisitor) { manualStarted.current = true; setManual(true); clear('auto'); }
    const next = ++progress.current;
    setCount(next);
    const motion = current.environment.onScreen && current.environment.visible && !current.environment.reduced;
    clear('press'); automaticPress.current = !byVisitor;
    setPressing(motion);
    if (motion) timers.current.press = window.setTimeout(() => { setPressing(false); automaticPress.current = false; }, 140);
    if (byVisitor && next >= 12 && !celebrated.current) {
      celebrated.current = true; setShowToast(true); setCelebrating(motion);
      if (motion) timers.current.celebration = window.setTimeout(() => setCelebrating(false), 900);
      timers.current.toast = window.setTimeout(() => setShowToast(false), 4000);
    }
  }, [clear]);
  const onSave = useCallback(() => recordSave(true), [recordSave]);
  const eligible = view === 'phenome' && environment.onScreen && environment.visible && !environment.reduced && !environment.keyboard && !manual && count < 6;
  const eligibility = useRef(eligible); eligibility.current = eligible;
  useEffect(() => {
    if (!eligible) return;
    timers.current.auto = window.setTimeout(() => { if (eligibility.current && !manualStarted.current) recordSave(false); }, 600);
    return () => clear('auto');
  }, [eligible, count, clear, recordSave]);
  useEffect(() => {
    if (view === 'phenome' && environment.reduced && !manualStarted.current && progress.current < 6) { progress.current = 6; setCount(6); }
    if (view !== 'phenome' || !environment.onScreen || !environment.visible || environment.reduced) {
      clear('press'); clear('celebration'); automaticPress.current = false; setPressing(false); setCelebrating(false);
    }
    if (view !== 'phenome' || !environment.onScreen || !environment.visible) { clear('toast'); setShowToast(false); }
  }, [view, environment.onScreen, environment.visible, environment.reduced, clear]);
  useEffect(() => () => { for (const name of ['auto', 'press', 'celebration', 'toast'] as const) clear(name); }, [clear]);

  return { count, pressing, showPointer: !manual && !environment.keyboard && !environment.reduced && environment.onScreen && environment.visible && view === 'phenome' && (eligible || pressing && automaticPress.current), celebrating, showToast, onSave };
}
