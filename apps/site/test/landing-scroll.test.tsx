import React, { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLandingScroll } from '../src/useLandingScroll';
import type { LandingView } from '../src/landingSystemData';

let sceneHeight = 500;
let positions = [1000, 1500, 2000];
let reduced = false;
let keyboardMode = false;
const mediaListeners = new Set<() => void>();
const box = (top: number, height = 250) => ({ top, bottom: top + height, height, width: 600, left: 0, right: 600, x: 0, y: top, toJSON: () => ({}) });
function Harness() {
  const scene = useRef<HTMLDivElement>(null), controls = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<LandingView>('genome');
  const { pinned, manual, chooseView } = useLandingScroll(scene, controls, setView);
  return <section id="home-system-story"><div ref={scene} data-test-scene="" data-pinned={String(pinned)}><div ref={controls}>
    {(['genome', 'proteome', 'phenome'] as const).map(item => <button key={item} onClick={() => chooseView(item)}>{item}</button>)}
  </div><output>{view}:{String(manual)}</output></div>
    {(['genome', 'proteome', 'phenome'] as const).map(item => <article key={item} data-story-step={item} />)}
    <button>Outside controls</button>
  </section>;
}
const flush = () => act(() => { vi.runOnlyPendingTimers(); });
beforeEach(() => {
  vi.useFakeTimers(); sceneHeight = 500; positions = [1000, 1500, 2000]; reduced = false; keyboardMode = false;
  const nativeMatches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) { return selector === ':focus-visible' ? keyboardMode : nativeMatches.call(this, selector); });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-test-scene')) return box(24, sceneHeight);
    const index = ['genome', 'proteome', 'phenome'].indexOf(this.dataset.storyStep ?? '');
    return box(index >= 0 ? positions[index] : 0);
  });
});
afterEach(() => { cleanup(); mediaListeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('follows narrative panels and keeps manual choice until a different panel', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'phenome' }));
  expect(screen.getByText('phenome:true')).toBeTruthy();
  positions = [200, 700, 1200]; fireEvent.scroll(window); flush();
  expect(screen.getByText('phenome:true')).toBeTruthy();
  positions = [-400, 200, 700]; fireEvent.scroll(window); flush();
  expect(screen.getByText('proteome:false')).toBeTruthy();
});
it('suspends automatic selection while the controls retain keyboard focus', () => {
  render(<Harness />);
  keyboardMode = true;
  screen.getByRole('button', { name: 'genome' }).focus();
  positions = [-400, 200, 700]; fireEvent.scroll(window); flush();
  expect(screen.getByText('genome:false')).toBeTruthy();
  screen.getByRole('button', { name: 'Outside controls' }).focus(); flush();
  expect(screen.getByText('proteome:false')).toBeTruthy();
});
it('uses normal flow for short mobile viewports and reduced motion while keeping controls', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 667 });
  const { container } = render(<Harness />);
  expect(container.querySelector('[data-pinned]')?.getAttribute('data-pinned')).toBe('false');
  positions = [-400, 100, 200]; fireEvent.scroll(window); flush();
  expect(screen.getByText('genome:false')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'phenome' }));
  expect(screen.getByText('phenome:true')).toBeTruthy();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  reduced = true; act(() => { for (const listener of mediaListeners) listener(); }); flush();
  expect(container.querySelector('[data-pinned]')?.getAttribute('data-pinned')).toBe('false');
});
it('pins only when measured geometry leaves room and releases queued work on unmount', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const { container, unmount } = render(<Harness />);
  expect(container.querySelector('[data-pinned]')?.getAttribute('data-pinned')).toBe('false');
  sceneHeight = 350; fireEvent.resize(window); flush();
  expect(container.querySelector('[data-pinned]')?.getAttribute('data-pinned')).toBe('true');
  fireEvent.scroll(window); unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(mediaListeners.size).toBe(0);
});
