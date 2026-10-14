import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** Wide screens follow the step nearest the reading line; a chosen step holds until the reader scrolls to another. */
export function useLandingScroll(root: RefObject<HTMLElement | null>, setStep: (index: number) => void) {
  const [enhanced, setEnhanced] = useState(false), [following, setFollowing] = useState(false);
  const shown = useRef(0), heldAt = useRef<number | null>(null), reading = useRef(0);
  const chooseStep = useCallback((index: number) => { heldAt.current = reading.current; shown.current = index; setStep(index); }, [setStep]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setEnhanced(true);
    const steps = [...element.querySelectorAll<HTMLElement>('[data-checkout-step]')];
    const wide = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 951px)') : null;
    let frame = 0, alive = true;
    const measure = () => {
      frame = 0; if (!alive) return;
      const enabled = !!wide?.matches; setFollowing(enabled);
      if (!enabled) return;
      const line = window.innerHeight * .5;
      let index = 0;
      steps.forEach((step, i) => { if (step.getBoundingClientRect().top <= line) index = i; });
      reading.current = index;
      if (heldAt.current !== null) { if (heldAt.current === index) return; heldAt.current = null; }
      if (index !== shown.current) { shown.current = index; setStep(index); }
    };
    const schedule = () => { if (!frame && alive) frame = requestAnimationFrame(measure); };
    window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    wide?.addEventListener('change', schedule); measure();
    return () => {
      alive = false; if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); wide?.removeEventListener('change', schedule);
    };
  }, [root, setStep]);
  return { enhanced, following, chooseStep };
}
