import React, { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLandingDemo } from '../src/useLandingDemo';
import type { LandingView } from '../src/landingSystemData';

let reduced = false, hidden = false, keyboard = false;
let intersection: IntersectionObserverCallback;
const mediaListeners = new Set<() => void>();
const disconnect = vi.fn();
function Harness({ view = 'genome' }: { view?: LandingView }) {
  const scene = useRef<HTMLDivElement>(null);
  const demo = useLandingDemo(scene, view);
  return <><div ref={scene}><button onClick={demo.onSave}>Save example</button><span data-testid="count">{demo.count}</span>
    <span data-testid="motion" data-press={String(demo.pressing)} data-pointer={String(demo.showPointer)} data-confetti={String(demo.celebrating)} />
    {demo.showToast && <p role="status">Great energy!</p>}</div><button>Outside story</button></>;
}
const tick = (ms = 600) => act(() => vi.advanceTimersByTime(ms));
const count = () => Number(screen.getByTestId('count').textContent);
const motion = (name: string) => screen.getByTestId('motion').getAttribute('data-' + name);
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save example' }));
const visible = (value: boolean) => act(() => intersection([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver));
beforeEach(() => {
  vi.useFakeTimers(); reduced = false; hidden = false; keyboard = false; disconnect.mockClear();
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => hidden ? 'hidden' : 'visible');
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) }));
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { intersection = callback; } observe() {} disconnect = disconnect; });
  const matches = HTMLElement.prototype.matches;
  vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (this: HTMLElement, selector: string) { return selector === ':focus-visible' ? keyboard : matches.call(this, selector); });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 20, bottom: 420, height: 400, width: 600, left: 0, right: 600, x: 0, y: 20, toJSON() {} });
});
afterEach(() => { cleanup(); mediaListeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('begins only in Phenome and stops after six illustrative presses', () => {
  const harness = render(<Harness />); tick(4000); expect(count()).toBe(0);
  harness.rerender(<Harness view="phenome" />);
  expect(motion('pointer')).toBe('true');
  for (let i = 1; i <= 6; i++) { tick(); expect(count()).toBe(i); }
  tick(7000); expect(count()).toBe(6); expect(motion('pointer')).toBe('false'); expect(motion('press')).toBe('false');
  expect(screen.queryByRole('status')).toBe(null);
});
it('a manual press immediately cancels the remaining automatic head start', () => {
  render(<Harness view="phenome" />); tick(); tick(); save(); expect(count()).toBe(3);
  tick(10000); visible(false); visible(true); tick(10000); expect(count()).toBe(3); expect(motion('pointer')).toBe('false');
});
it('pauses unfinished automation offscreen and in a hidden document', () => {
  render(<Harness view="phenome" />); tick(); visible(false); tick(3000); expect(count()).toBe(1);
  visible(true); tick(); expect(count()).toBe(2);
  hidden = true; fireEvent(document, new Event('visibilitychange')); tick(3000); expect(count()).toBe(2);
  hidden = false; fireEvent(document, new Event('visibilitychange')); tick(); expect(count()).toBe(3);
});
it('pauses while any demo control has keyboard focus and hands over on activation', () => {
  render(<Harness view="phenome" />); keyboard = true;
  act(() => screen.getByRole('button', { name: 'Save example' }).focus()); tick(3000); expect(count()).toBe(0);
  save(); expect(count()).toBe(1);
  act(() => screen.getByRole('button', { name: 'Outside story' }).focus()); tick(3000); expect(count()).toBe(1);
});
it('preserves progress across view changes and never repeats a completed head start', () => {
  const harness = render(<Harness view="phenome" />); tick(); tick(); expect(count()).toBe(2);
  harness.rerender(<Harness view="genome" />); tick(3000); expect(count()).toBe(2);
  harness.rerender(<Harness view="phenome" />); for (let i = 0; i < 4; i++) tick(); expect(count()).toBe(6);
  harness.rerender(<Harness view="proteome" />); harness.rerender(<Harness view="phenome" />); tick(4000); expect(count()).toBe(6);
});
it('celebrates once at twelve, keeps an exact growing count, and does not replay after switching views', () => {
  const harness = render(<Harness view="phenome" />);
  for (let i = 0; i < 12; i++) save();
  expect(count()).toBe(12); expect(motion('confetti')).toBe('true'); expect(screen.getByRole('status').textContent).toBe('Great energy!');
  tick(1500); expect(motion('confetti')).toBe('false');
  save(); expect(count()).toBe(13); expect(motion('confetti')).toBe('false');
  harness.rerender(<Harness view="genome" />); harness.rerender(<Harness view="phenome" />); tick(5000); save();
  expect(count()).toBe(14); expect(screen.queryByRole('status')).toBe(null); expect(motion('confetti')).toBe('false');
});
it('reduced motion starts half full and supports manual updates and the toast without animated effects', () => {
  reduced = true; render(<Harness view="phenome" />); expect(count()).toBe(6); tick(5000); expect(count()).toBe(6);
  for (let i = 0; i < 6; i++) save();
  expect(count()).toBe(12); expect(motion('pointer')).toBe('false'); expect(motion('press')).toBe('false'); expect(motion('confetti')).toBe('false');
  expect(screen.getByRole('status').textContent).toBe('Great energy!');
});
it('disposes pending automatic, press, toast, observer and media work on unmount', () => {
  const harness = render(<Harness view="phenome" />); for (let i = 0; i < 12; i++) save(); harness.unmount();
  expect(vi.getTimerCount()).toBe(0); expect(mediaListeners.size).toBe(0); expect(disconnect).toHaveBeenCalledOnce();
});

it('resumes unfinished automation after keyboard focus leaves, before any manual save', () => {
  render(<Harness view="phenome" />); keyboard = true;
  act(() => screen.getByRole('button', { name: 'Save example' }).focus()); tick(2000); expect(count()).toBe(0);
  act(() => screen.getByRole('button', { name: 'Outside story' }).focus()); tick(); expect(count()).toBe(1);
});
it('responds to a runtime reduced-motion preference without restarting the completed head start', () => {
  render(<Harness view="phenome" />); tick(); tick(); expect(count()).toBe(2);
  reduced = true; act(() => { for (const listener of mediaListeners) listener(); });
  expect(count()).toBe(6); expect(motion('pointer')).toBe('false'); expect(motion('press')).toBe('false');
  reduced = false; act(() => { for (const listener of mediaListeners) listener(); }); tick(4000); expect(count()).toBe(6);
});
