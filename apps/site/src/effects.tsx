import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { AmbientField, EffectsProvider, Orb, type AmbientFieldHandle, type OrbHandle } from '@artyfact/effects';
import { currentSelection, subscribeSelection } from './systemState';
import { layerAngle, orbState, subjectAngle } from './orbState';

/*
 * Decorative WebGL layers, mounted with createRoot into empty, server-rendered slots after the page has hydrated, so
 * they never take part in hydration. Both canvases are aria-hidden; the page reads the same without them.
 */

const useSelection = () => useSyncExternalStore(subscribeSelection, currentSelection, currentSelection);

function HeroOrb({ slot }: { slot: HTMLElement }) {
  const selection = useSelection();
  const state = orbState(selection);
  const orb = useRef<OrbHandle>(null);
  const previous = useRef(selection);
  useEffect(() => {
    const before = previous.current;
    previous.current = selection;
    slot.dataset.orbFacet = state.facet;
    slot.dataset.orbState = state.label;
    if (before.layer !== selection.layer) orb.current?.pulse(0.9, layerAngle(selection.layer));
    if (before.subject !== selection.subject) {
      orb.current?.spark(subjectAngle(selection.subject));
      orb.current?.pulse(0.5, subjectAngle(selection.subject));
    }
  }, [selection, slot, state.facet, state.label]);
  return <Orb ref={orb} preset={state.preset} {...state.params} size={0.7} transition={0.7} hoverStrength={0.5} />;
}

function Ambient() {
  const selection = useSelection();
  const field = useRef<AmbientFieldHandle>(null);
  const [hasOrb] = useState(() => !!document.querySelector('[data-hero-orb]'));
  useEffect(() => {
    // A soft ripple from a call to action or workflow step when the pointer arrives on it.
    const onEnter = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.('.button.primary, .workflow-list li');
      if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
      const rect = target.getBoundingClientRect();
      field.current?.pulse(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.6);
    };
    document.addEventListener('pointerover', onEnter);
    return () => document.removeEventListener('pointerover', onEnter);
  }, []);
  // Only the home page's colour follows the example; elsewhere the haze stays apricot.
  const color = hasOrb ? orbState(selection).ambient : undefined;
  return <AmbientField ref={field} position="absolute" color={color} intensity={0.32} density={0.35} motion={0.6} parallax={0.35} />;
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render driver/i;

/**
 * False without WebGL2 or when it is software rendered (SwiftShader, llvmpipe: machines and CI runners without a
 * usable GPU). There the orb's particle field takes most of the main thread and the explorer stops responding to
 * input, so the effects keep their CSS fallbacks instead. Chromium does not flag SwiftShader through
 * failIfMajorPerformanceCaveat, so the renderer string is checked too.
 */
export function hasFastWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(gl.RENDERER)) + ' ' + String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !SOFTWARE_RENDERER.test(renderer);
  } catch { return false; }
}

export function mountEffects() {
  const enabled = hasFastWebGL2();
  const mount = (slot: HTMLElement, node: React.ReactNode) => createRoot(slot).render(<EffectsProvider enabled={enabled}>{node}</EffectsProvider>);
  const orbSlot = document.querySelector<HTMLElement>('[data-hero-orb]');
  if (orbSlot) mount(orbSlot, <HeroOrb slot={orbSlot} />);
  const ambientSlot = document.querySelector<HTMLElement>('[data-ambient]');
  if (ambientSlot) mount(ambientSlot, <Ambient />);
}
