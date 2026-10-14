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
  for (const text of ['What should this explanation achieve?', 'Your agents do the making.', 'Page read', 'Views explored', 'Reader feedback', 'Understanding reviewed']) {
    expect(html).toContain(text);
  }
  expect(html).toContain('Acceptance check');
  expect(html).toContain('example-model-01');
});
it('keeps one illustrative feature in all three parallel views', () => {
  render(<SystemExplorer />);
  expect(screen.getByText('Declared in the Genome')).toBeTruthy();
  expect(screen.getByText(/Explain Artyfact clearly/)).toBeTruthy();
  expect(screen.getByText(/canonical Genome names this page/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Proteome/ }));
  expect(screen.getByRole('heading', { name: /Your agents do the making/ })).toBeTruthy();
  expect(screen.getByText(/Given this model page/)).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Phenome/ }));
  for (const label of ['Page read', 'Views explored', 'Reader feedback', 'Understanding reviewed']) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText(/not live Artyfact telemetry/)).toBeTruthy();
  expect(screen.getByText('example-model-01')).toBeTruthy();
  expect(screen.queryByText('Passed')).toBe(null);
  expect(screen.getByText(/Explain Artyfact clearly/)).toBeTruthy();
  expect(screen.getByText(/not steps one after another/)).toBeTruthy();
  const panels = screen.getAllByRole('tabpanel', { hidden: true });
  expect(panels).toHaveLength(3);
  expect(panels.map(panel => panel.hasAttribute('hidden'))).toEqual([true, true, false]);
});
it('leads each view with plain words and keeps the product name as a label', () => {
  render(<SystemExplorer />);
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['What it should beGenome', 'What is being madeProteome', 'What it doesPhenome']);
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
