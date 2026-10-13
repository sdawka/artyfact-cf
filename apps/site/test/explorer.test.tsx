import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { SystemExplorer } from '../src/SystemExplorer';
afterEach(cleanup);
it('includes all three complete views in static HTML before hydration', () => {
  const html = renderToString(<SystemExplorer />);
  const staticPage = document.createElement('div');
  staticPage.innerHTML = html;
  expect(staticPage.querySelector('.layer-tabs')?.hasAttribute('hidden')).toBe(true);
  expect([...staticPage.querySelectorAll('.example-detail')].every(panel => !panel.hasAttribute('hidden'))).toBe(true);
  for (const text of ['What needs to be clear?', 'Your agents can be the Proteome.', 'Input received', 'Intent confirmed', 'Change mapped', 'Evaluation completed']) {
    expect(html).toContain(text);
  }
  expect(html).toContain('Proposed acceptance test');
  expect(html).toContain('example-scope-01');
});
it('keeps one illustrative feature in all three parallel views', () => {
  render(<SystemExplorer />);
  expect(screen.getByText('Illustrative target')).toBeTruthy();
  expect(screen.getByText(/Make changes easy to scope and specify/)).toBeTruthy();
  expect(screen.getByText(/requested behavior, affected subjects and acceptance criteria/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Proteome/ }));
  expect(screen.getByRole('heading', { name: /Your agents can be the Proteome/ })).toBeTruthy();
  expect(screen.getByText(/Given a requested change, when a reviewer opens it/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Phenome/ }));
  for (const label of ['Input received', 'Intent confirmed', 'Change mapped', 'Evaluation completed']) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText(/not live Artyfact telemetry/)).toBeTruthy();
  expect(screen.getByText('example-scope-01')).toBeTruthy();
  expect(screen.queryByText('Passed')).toBe(null);
  expect(screen.getByText(/Make changes easy to scope and specify/)).toBeTruthy();
  const panels = screen.getAllByRole('tabpanel', { hidden: true });
  expect(panels).toHaveLength(3);
  expect(panels.map(panel => panel.hasAttribute('hidden'))).toEqual([true, true, false]);
});
it('supports keyboard navigation across views', () => {
  render(<SystemExplorer />);
  fireEvent.keyDown(screen.getByRole('tab', { name: /Genome/ }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /Proteome/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: /Proteome/ }), { key: 'End' });
  expect(screen.getByRole('tab', { name: /Phenome/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tab', { name: /Phenome/ }), { key: 'Home' });
  expect(screen.getByRole('tab', { name: /Genome/ }).getAttribute('aria-selected')).toBe('true');
});
