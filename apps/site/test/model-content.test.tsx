import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ModelContent } from '../src/ModelContent';

afterEach(cleanup);

it('carries one illustrative change from the System boundary into form and content', () => {
  const { container } = render(<ModelContent />);
  expect(screen.getByRole('heading', { level: 1, name: /^Ontology Driven Development$/ })).toBeTruthy();
  const text = container.textContent ?? '';
  expect(text.indexOf('Make changes easy to scope and specify')).toBeLessThan(text.indexOf('A Thing has form and content'));
  expect(text).toContain('one or more Things');
  expect(text).toContain('Peopling System');
  expect(text).toContain('Whole contact application');
  expect(text).toContain('Frontend');
  expect(text).toContain('typed links');
  expect(text).toContain('Nested subjects are not additional Things or Parts');
  expect(text).toContain('requested behavior and affected subjects');
});

it('keeps Parts and Rule Packs distinct and closes on the same feature', () => {
  render(<ModelContent />);
  expect(screen.getByText(/A Thing can begin with its Genome alone/)).toBeTruthy();
  expect(screen.getByText(/Part is incomplete in context/)).toBeTruthy();
  expect(screen.getByText(/Rule Packs check shared constraints/)).toBeTruthy();
  expect(screen.getByText(/authorization pack checks modeled policy coverage/)).toBeTruthy();
  expect(screen.getByText(/Source and each build output keep distinct identities/)).toBeTruthy();
  expect(screen.getByText(/Did the candidate meet the stated criterion/)).toBeTruthy();
  expect(screen.getByText(/Did people find scoping easier/)).toBeTruthy();
});

it('uses one explorer and no second expanded three-view recap', () => {
  const { container } = render(<ModelContent />);
  expect(container.querySelectorAll('[data-system-explorer]')).toHaveLength(1);
  expect(container.querySelectorAll('.model-view-notes')).toHaveLength(0);
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
  expect(within(benefits as HTMLElement).getAllByRole('heading', { level: 3 })).toHaveLength(6);
  expect(benefits!.querySelector('[data-system-explorer]')).toBeNull();
  expect(ontology!.getAttribute('tabindex')).toBe('-1');
});
