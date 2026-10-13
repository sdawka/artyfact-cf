import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingSystemScene } from '../src/LandingSystemScene';
import type { LandingSubject } from '../src/landingSystemData';

afterEach(cleanup);

it('starts with readable empty shape slots in server markup', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(<LandingSystemScene view="genome" selectedSubject="app" />);
  const app = within(host).getByRole('article', { name: 'Application: Fieldnotes' });
  expect(within(app).getByText('Capture a note')).toBeTruthy();
  expect(within(app).getByText('Save a note')).toBeTruthy();
  expect(within(app).getByText('Revisit saved notes')).toBeTruthy();
  expect(within(app).queryByText('Morning by the lake')).toBeNull();
  expect(within(app).queryByRole('textbox')).toBeNull();
  expect(within(app).queryByRole('button', { name: 'Save record' })).toBeNull();
  expect(within(host).queryByText('record.saved')).toBeNull();
  expect(within(host).queryByText('Sample saves')).toBeNull();
});

it('retains anchored application and runtime cards across all views', () => {
  const { rerender } = render(<LandingSystemScene view="genome" selectedSubject="app" />);
  const app = screen.getByRole('article', { name: 'Application: Fieldnotes' });
  const runtime = screen.getByRole('article', { name: 'Runtime: API and storage' });
  rerender(<LandingSystemScene view="proteome" selectedSubject="app" />);
  expect(screen.getByRole('article', { name: 'Application: Fieldnotes' })).toBe(app);
  expect(screen.getByRole('article', { name: 'Runtime: API and storage' })).toBe(runtime);
  expect(screen.getByRole('textbox', { name: 'New note' }).getAttribute('readonly')).toBe('');
  expect(screen.queryByRole('button', { name: 'Save record' })).toBeNull();
  expect(screen.queryByRole('form')).toBeNull();
  rerender(<LandingSystemScene view="phenome" selectedSubject="app" />);
  expect(screen.getByRole('article', { name: 'Application: Fieldnotes' })).toBe(app);
  expect(screen.getByRole('button', { name: 'Save record' })).toBeTruthy();
});

it('keeps sample Save and inspection separate and reflects exact count beyond chart range', () => {
  function Example() {
    const [count, setCount] = useState(12);
    const [selectedSubject, setSubject] = useState<LandingSubject>('runtime');
    return <LandingSystemScene view="phenome" selectedSubject={selectedSubject} onSelectSubject={setSubject}
      demo={{ count, pressing: false, showPointer: false, celebrating: false, showToast: false, onSave: () => setCount(value => value + 1) }} />;
  }
  const { container } = render(<Example />);
  const save = screen.getByRole('button', { name: 'Save record' });
  fireEvent.click(save);
  expect(screen.getByRole('img', { name: /Sample saves: 13/ })).toBeTruthy();
  expect(screen.getByText('13 saves')).toBeTruthy();
  expect(screen.getByText('12+')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Inspect API and storage' }).getAttribute('aria-pressed')).toBe('true');
  expect(container.querySelector('button button')).toBeNull();
  expect(container.querySelector('[data-chart-level="12"]')).toBeTruthy();
  expect(container.querySelector('[role="img"] [aria-live]')).toBeNull();
});

it('exposes pinned composition and explicit replacement adapters through details', () => {
  function Example() {
    const [selectedSubject, setSubject] = useState<LandingSubject>('app');
    return <LandingSystemScene view="proteome" selectedSubject={selectedSubject} onSelectSubject={setSubject} />;
  }
  render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: 'Part: Component system' }));
  const detail = screen.getByRole('region', { name: 'Selected subject' });
  expect(within(detail).getByText(/explicit Button override/)).toBeTruthy();
  fireEvent.click(within(detail).getByText('Composition + provenance'));
  expect(within(detail).getByText(/caller adapter/)).toBeTruthy();
  expect(within(detail).getByText(/config adapter/)).toBeTruthy();
  expect(within(detail).getByText(/v2.4.0/)).toBeTruthy();
  expect(within(detail).getByText(/source S1/)).toBeTruthy();
  expect(within(detail).getByText(/output B1/)).toBeTruthy();
  expect(within(detail).getByText(/runtime R1/)).toBeTruthy();
});

it('renders one bounded decorative celebration and a polite toast', () => {
  const { container, rerender } = render(<LandingSystemScene view="phenome" selectedSubject="app"
    demo={{ count: 12, pressing: true, showPointer: true, celebrating: true, showToast: true, onSave: () => {} }} />);
  expect(screen.getByRole('status').textContent).toBe('Great energy!');
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  const confetti = container.querySelector('[data-scene-confetti]');
  expect(confetti?.getAttribute('aria-hidden')).toBe('true');
  expect(confetti?.children.length).toBeGreaterThan(0);
  expect(confetti?.children.length).toBeLessThanOrEqual(24);
  expect(container.querySelector('[data-demo-pointer]')?.getAttribute('aria-hidden')).toBe('true');
  rerender(<LandingSystemScene view="genome" selectedSubject="app"
    demo={{ count: 12, pressing: false, showPointer: false, celebrating: true, showToast: true, onSave: () => {} }} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(container.querySelector('[data-scene-confetti]')).toBeNull();
  expect(container.querySelector('canvas')).toBeNull();
});
