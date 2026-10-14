import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ModelContent } from '../src/ModelContent';
afterEach(cleanup);
it('opens with the checkout theory as a sentence whose parts carry claim field labels', () => {
  const { container } = render(<ModelContent />);
  expect(screen.getByRole('heading', { level: 1, name: 'Theory Driven Development' })).toBeTruthy();
  expect(screen.getByText('Every product is a theory.')).toBeTruthy();
  const card = container.querySelector('[data-theory-card]')!;
  const parts = [...card.querySelectorAll('[data-theory-part]')].map(part => [part.getAttribute('data-theory-part'), part.querySelector('.theory-part-text')!.textContent]);
  expect(parts).toEqual([['mechanism', 'loyalty points'], ['beneficiary', 'returning shoppers'], ['outcome', 'come back to buy again'], ['indicator', 'repeat orders within 30 days']]);
  expect(card.querySelector('[data-status="unknown"]')).toBeTruthy();
  expect(card.textContent).toContain('Measurement in progress');
});
it('makes the loop discoverable as six readable steps that keep the two approvals distinct', () => {
  const { container } = render(<ModelContent />);
  const link = within(screen.getByRole('navigation', { name: 'On this page' })).getByRole('link', { name: 'How a change moves' });
  const lifecycle = container.querySelector(link.getAttribute('href')!)!;
  expect(lifecycle.id).toBe('lifecycle');
  const steps = [...lifecycle.querySelectorAll('ol > li')];
  expect(steps.map(step => step.getAttribute('data-loop-step'))).toEqual(['theory', 'build', 'check', 'ship', 'observe', 'revise']);
  for (const step of steps) expect(step.querySelector('details > summary .term-label')).toBeTruthy();
  expect(steps[0].textContent).toContain('An Evolution changes the Genome');
  expect(steps[1].textContent).toContain('accepted Genome revision');
  expect(steps[2].textContent).toContain('unknown blocks');
  expect(steps[3].textContent).toContain('Promoting is a separate approval');
  expect(steps[4].textContent).toContain('Measuring claim indicators is still in progress');
  expect(lifecycle.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
});
it('shows the real claim fields, statuses and theory rules, with outcome measurement unknown', () => {
  const { container } = render(<ModelContent />);
  const anatomy = container.querySelector<HTMLElement>('#claim-anatomy')!;
  expect([...anatomy.querySelectorAll('[data-claim-field]')].map(field => field.getAttribute('data-claim-field'))).toEqual(['mechanism', 'beneficiaries', 'outcome', 'indicator', 'evaluationMethod', 'limitation', 'status']);
  expect([...anatomy.querySelectorAll('.claim-statuses li')].map(item => item.getAttribute('data-status'))).toEqual(['unknown', 'inconclusive', 'supported', 'challenged']);
  expect(anatomy.querySelector('.claim-statuses [aria-current]')!.getAttribute('data-status')).toBe('unknown');
  for (const rule of ['theory.indicator', 'theory.method', 'theory.beneficiary', 'theory.outcomeUnlinked']) expect(within(anatomy).getByText(rule)).toBeTruthy();
  expect(anatomy.querySelector('[data-claim-field="status"]')!.textContent).toContain('Measurement in progress');
});
it('explains this actual page through its canonical subjects and criteria', () => {
  const { container } = render(<ModelContent />);
  for (const id of ['system.artyfact','thing.site','thing.site.pages','page.model','component.model-explanation','affordance.model.inspect-views']) expect(container.querySelector(`[data-model-subject="${id}"]`)).toBeTruthy();
  for (const criterion of ['Represent Artyfact accurately','Communicate clearly','Make the visual compelling']) expect(screen.getByText(criterion)).toBeTruthy();
  expect(container.textContent).toContain('The ontology is the vocabulary');
  expect(container.textContent).not.toContain('Scope editor');
});
it('explains Cloudflare mappings without treating every subject as a resource', () => {
  const { container } = render(<ModelContent />);
  for (const text of ['Cloudflare Artifacts','one or more artifacts','build output','Parts','not a deployed resource']) expect(container.textContent).toContain(text);
  expect(screen.getByText(/A Thing can start with its model alone/)).toBeTruthy();
  expect(screen.getByText(/authorization pack checks modeled policy coverage/)).toBeTruthy();
});
it('uses one progressive explorer and distinguishes review criteria from observed success', () => {
  const { container } = render(<ModelContent />);
  expect(container.querySelectorAll('[data-system-explorer]')).toHaveLength(1);
  expect(container.querySelector('#model-parallel-views')!.textContent).toContain('not stages one after another');
  expect(screen.getByText(/a passing check establishes only what that check measured/)).toBeTruthy();
});
it('links the platform only when one is configured', () => {
  render(<ModelContent />);
  expect(screen.queryByRole('link', { name: 'Open the platform' })).toBeNull();
  cleanup();
  render(<ModelContent platform="https://platform.example" />);
  expect(screen.getByRole('link', { name: 'Open the platform' }).getAttribute('href')).toBe('https://platform.example');
});

// Broken anchor targets lose the reading path that home and /connect-agent link into.
it('lets readers jump to every section, each a focusable anchor', () => {
  const { container } = render(<ModelContent />);
  const links = within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link');
  expect(links.map(link => link.getAttribute('href'))).toEqual(['#lifecycle', '#claim-anatomy', '#meta-ontology', '#model-parallel-views', '#benefits']);
  for (const link of links) expect(container.querySelector(link.getAttribute('href')!)!.getAttribute('tabindex')).toBe('-1');
  const benefits = container.querySelector('#benefits')!;
  expect(benefits.querySelectorAll('details')).toHaveLength(4);
  expect(benefits.querySelector('[data-system-explorer]')).toBeNull();
});
