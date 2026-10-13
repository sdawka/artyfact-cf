import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemExplorer } from '../src/SystemExplorer';
afterEach(cleanup);
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
