import React, { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingSystemScene } from '../src/LandingSystemScene';
import type { LandingSubject } from '../src/landingSystemData';

afterEach(cleanup);

it('renders the intended application and composition as readable server markup', () => {
  const markup = renderToStaticMarkup(<LandingSystemScene view="genome" selectedSubject="app" />);
  const host = document.createElement('div');
  host.innerHTML = markup;
  expect(host.querySelector('[data-scene-view="genome"]')).toBeTruthy();
  expect(within(host).getByRole('button', { name: /Application: Fieldnotes/ })).toBeTruthy();
  expect(within(host).getByRole('button', { name: /Part: Astro starter/ })).toBeTruthy();
  expect(within(host).getByRole('button', { name: /Part: Component system/ })).toBeTruthy();
  expect(within(host).getByRole('button', { name: /Runtime: API and storage/ })).toBeTruthy();
  expect(within(host).getByText('Outcome evidence: unmeasured')).toBeTruthy();
  expect(host.querySelector('[style]')).toBeNull();
});

it('retains the same app and component identities when changing the view', () => {
  const { container, rerender } = render(<LandingSystemScene view="genome" selectedSubject="app" />);
  const app = screen.getByRole('button', { name: /Application: Fieldnotes/ });
  const components = screen.getByRole('button', { name: /Part: Component system/ });
  rerender(<LandingSystemScene view="proteome" selectedSubject="app" />);
  expect(screen.getByRole('button', { name: /Application: Fieldnotes/ })).toBe(app);
  expect(screen.getByRole('button', { name: /Part: Component system/ })).toBe(components);
  expect(container.querySelector('[data-scene-view="proteome"]')).toBeTruthy();
  rerender(<LandingSystemScene view="phenome" selectedSubject="app" />);
  expect(screen.getByRole('button', { name: /Application: Fieldnotes/ })).toBe(app);
  expect(screen.getByText('record.saved')).toBeTruthy();
  expect(screen.getByText('GET /api/records 200')).toBeTruthy();
  expect(screen.getByText('Sample activity')).toBeTruthy();
  expect(screen.getByText('Outcome evidence: unmeasured')).toBeTruthy();
});

it('selects Parts with native buttons and exposes explicit override and adapter details', () => {
  function Example() {
    const [selectedSubject, setSubject] = useState<LandingSubject>('app');
    return <LandingSystemScene view="proteome" selectedSubject={selectedSubject} onSelectSubject={setSubject} />;
  }
  render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: /Part: Component system/ }));
  expect(screen.getByRole('button', { name: /Part: Component system/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: /Application: Fieldnotes/ }).getAttribute('aria-pressed')).toBe('false');
  const detail = screen.getByRole('region', { name: 'Selected subject' });
  expect(within(detail).getByText(/explicit Button override/)).toBeTruthy();
  expect(within(detail).getByText(/caller adapter/)).toBeTruthy();
  expect(within(detail).getByText(/config adapter/)).toBeTruthy();
});

it('labels composition and runtime relationships independently of decorative connections', () => {
  render(<LandingSystemScene view="proteome" selectedSubject="runtime" />);
  expect(screen.getByRole('list', { name: 'System relationships' })).toBeTruthy();
  expect(screen.getByText('Parts compose the application')).toBeTruthy();
  expect(screen.getByText('Application calls API; API persists records')).toBeTruthy();
  expect(screen.getByText('source S1')).toBeTruthy();
  expect(screen.getByText('output B1')).toBeTruthy();
  expect(screen.getByText('runtime R1')).toBeTruthy();
});

it('bounds decoration and keeps it hidden from assistive technology', () => {
  const { container } = render(<LandingSystemScene view="genome" selectedSubject="app" />);
  const decoration = container.querySelector('[data-scene-decoration]');
  expect(decoration?.getAttribute('aria-hidden')).toBe('true');
  expect(decoration?.querySelectorAll('circle').length).toBeGreaterThan(0);
  expect(decoration?.querySelectorAll('circle').length).toBeLessThanOrEqual(18);
  expect(decoration?.querySelectorAll('line').length).toBeLessThanOrEqual(18);
  expect(container.querySelector('canvas')).toBeNull();
});
