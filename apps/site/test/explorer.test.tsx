import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemExplorer } from '../src/SystemExplorer';
afterEach(cleanup);
it('keeps the same subject while moving between intent, work and evidence', () => {
  render(<SystemExplorer />);
  expect(screen.getByText('Only the owner can read a private contact.')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Proteome/ }));
  expect(screen.getByText('Two isolated realizations')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: /Phenome/ }));
  expect(screen.getByText('Unknown')).toBeTruthy();
  expect(screen.queryByText('Passed')).toBe(null);
  expect(screen.getByRole('button', { name: /Save a contact/ }).getAttribute('aria-pressed')).toBe('true');
});
it('supports keyboard navigation and choosing another subject', () => {
  render(<SystemExplorer />);
  fireEvent.keyDown(screen.getByRole('tab', { name: /Genome/ }), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: /Proteome/ }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: /Wanted contact/ }));
  fireEvent.click(screen.getByRole('tab', { name: /Genome/ }));
  expect(screen.getByText('More wanted contact, less effort remembering.')).toBeTruthy();
});
