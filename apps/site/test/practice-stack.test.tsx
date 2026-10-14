import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PracticeStack } from '../src/PracticeStack';
import { practices, relationLabels } from '../src/practiceStackData';

afterEach(cleanup);

it('shows every familiar practice in full beside what Artyfact does with it', () => {
  const { container } = render(<PracticeStack />);
  const cards = container.querySelectorAll('.practice-row');
  expect(cards).toHaveLength(practices.length);
  expect(container.querySelector('s, del, strike')).toBe(null);
  cards.forEach((card, index) => {
    expect(card.querySelector('.practice-known')?.textContent).toBe('You know: ' + practices[index].known);
    expect(card.querySelector('.practice-artyfact')?.textContent).toBe('In Artyfact: ' + practices[index].artyfact);
    expect(card.getAttribute('data-relation')).toBe(practices[index].relation);
    expect(card.querySelector('.relation-tag')?.textContent).toBe(relationLabels[practices[index].relation]);
  });
});
it('gives every practice a valid relation and links the theory from OKRs', () => {
  for (const practice of practices) expect(['built-in', 'extended', 'connected']).toContain(practice.relation);
  for (const relation of ['built-in', 'extended', 'connected'] as const) expect(practices.some(practice => practice.relation === relation)).toBe(true);
  const okrs = practices.find(practice => practice.known.startsWith('OKRs'));
  expect(okrs?.status).toBe('partial');
  expect(okrs?.link?.href).toBe('/model');
});
it('marks partial work and claims nothing outside yes or partial', () => {
  for (const practice of practices) expect(['yes', 'partial']).toContain(practice.status);
  for (const practice of practices.filter(item => item.status === 'partial')) expect(practice.note).toBeTruthy();
  const text = practices.map(practice => practice.artyfact).join(' ');
  expect(text).not.toMatch(/A\/B|experiment|cohort|SLO|incident/i);
});
