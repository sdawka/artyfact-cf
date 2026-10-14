import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Wide screens whose viewport fits the stage follow the step nearest the reading line; a chosen step is scrolled to and held until reached. */
export function useLandingScroll(root: RefObject<HTMLElement | null>, setStep: (index: number) => void) {
  const [enhanced, setEnhanced] = useState(false), [following, setFollowing] = useState(false);
  const shown = useRef(0), target = useRef<number | null>(null), release = useRef(0), enabled = useRef(false), remeasure = useRef(() => {});
  const chooseStep = useCallback((index: number) => {
    shown.current = index; setStep(index);
    const item = root.current?.querySelector<HTMLElement>(`[data-checkout-step="${index}"]`);
    if (!enabled.current || !item) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.current = index; window.clearTimeout(release.current);
    release.current = window.setTimeout(() => { target.current = null; remeasure.current(); }, 1500);
    item.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [root, setStep]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setEnhanced(true);
    const steps = [...element.querySelectorAll<HTMLElement>('[data-checkout-step]')];
    const stage = element.querySelector<HTMLElement>('.checkout-stage');
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 951px)') : null;
    let frame = 0, alive = true;
    const measure = () => {
      frame = 0; if (!alive) return;
      enabled.current = !!wide?.matches && (stage?.getBoundingClientRect().height ?? 0) <= window.innerHeight - 48;
      setFollowing(enabled.current);
      if (!enabled.current) return;
      const line = window.innerHeight * .5;
      let index = 0;
      steps.forEach((step, i) => { if (step.getBoundingClientRect().top <= line) index = i; });
      if (target.current !== null) { if (index !== target.current) return; target.current = null; }
      if (index !== shown.current) { shown.current = index; setStep(index); }
    };
    const schedule = () => { if (!frame && alive) frame = requestAnimationFrame(measure); };
    remeasure.current = schedule;
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    wide?.addEventListener('change', schedule); measure();
    return () => {
      alive = false; if (frame) cancelAnimationFrame(frame); window.clearTimeout(release.current);
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); wide?.removeEventListener('change', schedule);
    };
  }, [root, setStep]);
  return { enhanced, following, chooseStep };
}
