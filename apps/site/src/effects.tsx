import React, { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { AmbientField, EffectsProvider, type AmbientFieldHandle } from '@artyfact/effects';

/** Decorative atmosphere mounts after hydration, outside the meaningful example. */
function Ambient() {
  const field = useRef<AmbientFieldHandle>(null);
  useEffect(() => {
    const onEnter = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.('.button.primary');
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      const rect = target.getBoundingClientRect();
      field.current?.pulse(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.6);
    };
    document.addEventListener('pointerover', onEnter);
    return () => document.removeEventListener('pointerover', onEnter);
  }, []);
  return <AmbientField ref={field} position="absolute" intensity={0.32} density={0.35} motion={0.6} parallax={0.35} />;
}

export function mountEffects() {
  const ambientSlot = document.querySelector<HTMLElement>('[data-ambient]');
  if (ambientSlot) createRoot(ambientSlot).render(<EffectsProvider><Ambient /></EffectsProvider>);
}
