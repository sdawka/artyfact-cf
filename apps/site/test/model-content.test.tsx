import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ModelContent } from '../src/ModelContent';
afterEach(cleanup);
it('explains this actual page through its canonical subjects and criteria', () => {
  const { container } = render(<ModelContent />);
  expect(screen.getByRole('heading', { level: 1, name: /A model that can explain itself/ })).toBeTruthy();
  for (const id of ['system.artyfact','thing.site','thing.site.pages','page.model','component.model-explanation','affordance.model.inspect-views']) expect(container.querySelector(`[data-model-subject="${id}"]`)).toBeTruthy();
  for (const criterion of ['Represent Artyfact accurately','Communicate clearly','Make the visual compelling']) expect(screen.getByText(criterion)).toBeTruthy();
  expect(container.textContent).toContain('canonical Genome');
  expect(container.textContent).not.toContain('Scope editor');
});
it('explains Cloudflare mappings without treating every subject as a resource', () => {
  const { container } = render(<ModelContent />);
  for (const text of ['Cloudflare Artifacts','one or more artifacts','source','build output','Parts','not a deployed resource']) expect(container.textContent).toContain(text);
  expect(screen.getByText(/A Thing can begin with its Genome alone/)).toBeTruthy();
  expect(screen.getByText(/Rule Packs check shared constraints/)).toBeTruthy();
  expect(screen.getByText(/Source and each build output keep distinct identities/)).toBeTruthy();
});
it('uses one progressive explorer and distinguishes review criteria from observed success', () => {
  const { container } = render(<ModelContent />);
  expect(container.querySelectorAll('[data-system-explorer]')).toHaveLength(1);
  expect(screen.getByText(/A passing check establishes only what that check measured/)).toBeTruthy();
});
