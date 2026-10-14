import React, { useRef, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLandingScroll } from '../src/useLandingScroll';

let wide = true, stageHeight = 600, reduced = false;
const scrolled = vi.fn();
let positions = [1000, 1500, 2000];
const mediaListeners = new Set<() => void>();
const box = (top: number) => ({ top, bottom: top + 200, height: 200, width: 600, left: 0, right: 600, x: 0, y: top, toJSON: () => ({}) });
function Harness() {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const { enhanced, following, chooseStep } = useLandingScroll(root, setStep);
  return <div ref={root} data-enhanced={String(enhanced)} data-following={String(following)}>
    {[0, 1, 2].map(index => <button key={index} onClick={() => chooseStep(index)}>step {index}</button>)}
    <div className="checkout-stage" /><output>{step}</output>
    {[0, 1, 2].map(index => <article key={index} data-checkout-step={index} />)}
  </div>;
}
const flush = () => act(() => { vi.runOnlyPendingTimers(); });
const shown = () => screen.getByRole('status').textContent;
beforeEach(() => {
  vi.useFakeTimers(); wide = true; stageHeight = 600; reduced = false; positions = [1000, 1500, 2000]; scrolled.mockReset();
  HTMLElement.prototype.scrollIntoView = scrolled;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('reduced-motion') ? reduced : wide; }, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('checkout-stage')) return { ...box(24), height: stageHeight, bottom: 24 + stageHeight };
    return box(this.dataset.checkoutStep === undefined ? 0 : positions[Number(this.dataset.checkoutStep)]);
  });
});
afterEach(() => { cleanup(); mediaListeners.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('marks the story enhanced and follows the step nearest the reading line', () => {
  const { container } = render(<Harness />);
  expect(container.firstElementChild?.getAttribute('data-enhanced')).toBe('true');
  expect(container.firstElementChild?.getAttribute('data-following')).toBe('true');
  positions = [-400, 200, 700]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('1');
  positions = [-1000, -500, 300]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('2');
  positions = [0, 600, 1100]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('0');
});
it('scrolls a chosen step into view and holds it until the reader arrives', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'step 2' }));
  expect(shown()).toBe('2');
  expect(scrolled).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  positions = [-400, 200, 700]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('2');
  positions = [-1000, -500, 300]; fireEvent.scroll(window); flush();
  positions = [-400, 200, 700]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('1');
  reduced = true; fireEvent.click(screen.getByRole('button', { name: 'step 0' }));
  expect(scrolled).toHaveBeenLastCalledWith({ block: 'center', behavior: 'auto' });
});
it('does not follow scrolling when the stage is taller than the viewport', () => {
  stageHeight = 880;
  const { container } = render(<Harness />);
  expect(container.firstElementChild?.getAttribute('data-following')).toBe('false');
  positions = [-1000, -500, 300]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('0');
  fireEvent.click(screen.getByRole('button', { name: 'step 1' }));
  expect(scrolled).not.toHaveBeenCalled();
});
it('leaves narrow screens to the buttons and releases listeners on unmount', () => {
  wide = false;
  const { container, unmount } = render(<Harness />);
  expect(container.firstElementChild?.getAttribute('data-following')).toBe('false');
  positions = [-1000, -500, 300]; fireEvent.scroll(window); flush();
  expect(shown()).toBe('0');
  fireEvent.click(screen.getByRole('button', { name: 'step 1' }));
  expect(shown()).toBe('1');
  wide = true; act(() => { for (const listener of mediaListeners) listener(); }); flush();
  expect(shown()).toBe('2');
  fireEvent.scroll(window); unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(mediaListeners.size).toBe(0);
});
