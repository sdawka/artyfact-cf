import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingSystemScene, LandingSystemSupport } from '../src/LandingSystemScene';
import type { LandingDemo, LandingSubject } from '../src/landingSystemData';

afterEach(cleanup);
const demo = (count = 0): LandingDemo => ({ count, pressing: false, showPointer: false, celebrating: false, showToast: false, paused: false, completed: false, onSave: () => {}, onPause: () => {}, onResume: () => {} });

it('serves the empty Artyfact shape without editable fields or live actions', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<LandingSystemScene view="genome" selectedSubject="app" />);
  const app = within(host).getByRole('article', { name: 'Application: Artyfact' });
  const shape = app.querySelector('.scene-app-shape') as HTMLElement;
  expect(within(shape).getByText('System name')).toBeTruthy();
  expect(within(shape).getByText('Purpose')).toBeTruthy();
  expect(within(app).getByText('Explore another idea')).toBeTruthy();
  expect(within(app).queryByRole('textbox')).toBeNull();
  expect(within(app).queryByRole('button', { name: 'Randomize' })).toBeNull();
  expect(within(host).queryByRole('img', { name: /Ideas explored/ })).toBeNull();
  expect(within(host).getByText('Turn ideas into meaningful systems.')).toBeTruthy();
});

it('keeps app and runtime anchored while realizing noneditable name and purpose', () => {
  const { rerender } = render(<LandingSystemScene view="genome" selectedSubject="app" />);
  const app = screen.getByRole('article', { name: 'Application: Artyfact' });
  const runtime = screen.getByRole('article', { name: 'Runtime: API and storage' });
  rerender(<LandingSystemScene view="proteome" selectedSubject="app" />);
  expect(screen.getByRole('article', { name: 'Application: Artyfact' })).toBe(app);
  expect(screen.getByRole('article', { name: 'Runtime: API and storage' })).toBe(runtime);
  expect(within(app).getByText('Trailkeepers')).toBeTruthy();
  expect(within(app).getByText('Help neighbors care for the places they share.')).toBeTruthy();
  expect(within(app).queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Randomize' })).toBeNull();
  expect(screen.getByRole('img', { name: /Coding agents/ })).toBeTruthy();
  rerender(<LandingSystemScene view="phenome" selectedSubject="app" />);
  expect(screen.getByRole('article', { name: 'Application: Artyfact' })).toBe(app);
  expect(screen.getByRole('button', { name: 'Randomize' })).toBeTruthy();
});

it('randomizes curated ideas and keeps exact activity after the chart caps', () => {
  function Example() {
    const [count, setCount] = useState(12);
    const state = { ...demo(count), onSave: () => setCount(value => value + 1) };
    return <><LandingSystemScene view="phenome" selectedSubject="app" demo={state} /><LandingSystemSupport view="phenome" selectedSubject="app" demo={state} /></>;
  }
  const { container } = render(<Example />);
  const previous = screen.getByLabelText('Current System name').textContent;
  fireEvent.click(screen.getByRole('button', { name: 'Randomize' }));
  expect(screen.getByLabelText('Current System name').textContent).not.toBe(previous);
  expect(screen.getByRole('img', { name: /Ideas explored: 13/ })).toBeTruthy();
  expect(screen.getByText('13 ideas')).toBeTruthy();
  expect(screen.getByText('12+')).toBeTruthy();
  expect(container.querySelector('[data-chart-level="12"]')).toBeTruthy();
  expect(screen.getByRole('list', { name: 'Recent ideas' }).children.length).toBe(3);
  expect(container.querySelector('button button')).toBeNull();
  expect(container.querySelector('.scene-visual [aria-live]')).toBeNull();
});

it('keeps pause and resume controls at the same stable place', () => {
  let paused = false;
  const { rerender } = render(<LandingSystemScene view="phenome" selectedSubject="app" demo={{ ...demo(), onPause: () => { paused = true; } }} />);
  const button = screen.getByRole('button', { name: 'Pause demo' });
  fireEvent.click(button);
  expect(paused).toBe(true);
  rerender(<LandingSystemScene view="phenome" selectedSubject="app" demo={{ ...demo(), paused: true, onResume: () => { paused = false; } }} />);
  expect(screen.getByRole('button', { name: 'Resume demo' })).toBe(button);
  expect(button.hasAttribute('data-demo-resume')).toBe(true);
  fireEvent.click(button);
  expect(paused).toBe(false);
});

it('keeps Parts, recent history and provenance outside the visual frame', () => {
  function Example() {
    const [selectedSubject, setSubject] = useState<LandingSubject>('app');
    return <><LandingSystemScene view="proteome" selectedSubject={selectedSubject} demo={demo()} /><LandingSystemSupport view="proteome" selectedSubject={selectedSubject} onSelectSubject={setSubject} demo={demo()} /></>;
  }
  const { container } = render(<Example />);
  expect(container.querySelector('.scene-visual .scene-selected-detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Part: Component system' }));
  const detail = screen.getByRole('region', { name: 'Selected subject' });
  fireEvent.click(within(detail).getByText('Composition + provenance'));
  expect(within(detail).getByText(/caller adapter/)).toBeTruthy();
  expect(within(detail).getByText(/config adapter/)).toBeTruthy();
  expect(within(detail).getByText(/v2.4.0/)).toBeTruthy();
  expect(within(detail).getByText(/source S1/)).toBeTruthy();
});

it('bounds decorative celebration and places the polite toast in normal flow', () => {
  const state = { ...demo(12), pressing: true, showPointer: true, celebrating: true, showToast: true };
  const { container } = render(<><LandingSystemScene view="phenome" selectedSubject="app" demo={state} /><LandingSystemSupport view="phenome" selectedSubject="app" demo={state} /></>);
  expect(screen.getByRole('status').textContent).toBe('Great energy!');
  const confetti = container.querySelector('[data-scene-confetti]');
  expect(confetti?.getAttribute('aria-hidden')).toBe('true');
  expect(confetti?.children.length).toBeLessThanOrEqual(24);
  expect(container.querySelector('[data-demo-pointer]')?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelector('.scene-visual [role="status"]')).toBeNull();
});

it('keeps the completed demo control focused without promising an unavailable resume', () => {
  const { rerender } = render(<LandingSystemScene view="phenome" selectedSubject="app" demo={demo()} />);
  const control = screen.getByRole('button', { name: 'Pause demo' });
  control.focus();
  rerender(<LandingSystemScene view="phenome" selectedSubject="app" demo={{ ...demo(6), completed: true }} />);
  expect(screen.getByRole('button', { name: 'Auto demo complete' })).toBe(control);
  expect(control.getAttribute('aria-disabled')).toBe('true');
  expect(control.hasAttribute('disabled')).toBe(false);
  expect(document.activeElement).toBe(control);
});

it('hides empty history and retains observed ideas across view changes', () => {
  const { container, rerender } = render(<LandingSystemSupport view="genome" selectedSubject="app" demo={demo()} />);
  const history = container.querySelector('.scene-recent-ideas');
  expect(history).not.toBeNull();
  expect((history as HTMLElement).hidden).toBe(true);
  expect(screen.queryByRole('list', { name: 'Recent ideas' })).toBeNull();
  rerender(<LandingSystemSupport view="phenome" selectedSubject="app" demo={demo(1)} />);
  expect(container.querySelector('.scene-recent-ideas')).toBe(history);
  expect((history as HTMLElement).hidden).toBe(false);
  expect(screen.getByRole('list', { name: 'Recent ideas' }).children.length).toBe(1);
  rerender(<LandingSystemSupport view="genome" selectedSubject="app" demo={demo(1)} />);
  expect(screen.getByRole('list', { name: 'Recent ideas' }).children.length).toBe(1);
});

it('connects the scene exit to purpose and the current illustrative idea', () => {
  const { container } = render(<LandingSystemSupport view="phenome" selectedSubject="app" demo={demo(1)} />);
  expect(screen.getByRole('heading', { name: /Start with a purpose/ })).toBeTruthy();
  expect(container.querySelector('.scene-current-idea')?.textContent).toContain('Illustrative idea');
  expect(container.querySelector('.scene-current-idea')?.textContent).toContain('Small Signals');
});
