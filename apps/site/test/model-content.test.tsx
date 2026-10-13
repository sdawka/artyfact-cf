import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ModelContent } from '../src/ModelContent';
afterEach(cleanup);
it('explains this actual page through its canonical subjects and criteria', () => {
  const { container } = render(<ModelContent />);
  expect(screen.getByRole('heading', { level: 1, name: /Ontology Driven Development/ })).toBeTruthy();
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

// Broken anchor targets or moving the benefits into the example loses the two-part reading path.
it('lets readers jump from the approach benefits to the platform meta ontology', () => {
  const { container } = render(<ModelContent />);
  const navigation = screen.getByRole('navigation', { name: 'On this page' });
  const benefitsLink = within(navigation).getByRole('link', { name: 'Why a semantic layer' });
  const ontologyLink = within(navigation).getByRole('link', { name: 'Artyfact’s meta ontology' });
  const benefits = container.querySelector(benefitsLink.getAttribute('href')!);
  const ontology = container.querySelector(ontologyLink.getAttribute('href')!);
  expect(benefits).toBeTruthy();
  expect(ontology).toBeTruthy();
  expect(benefits!.compareDocumentPosition(ontology!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(benefits!.querySelectorAll('details')).toHaveLength(6);
  expect(benefits!.querySelector('[data-system-explorer]')).toBeNull();
  expect(ontology!.getAttribute('tabindex')).toBe('-1');
});
