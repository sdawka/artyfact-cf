import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PracticeStack } from '../src/PracticeStack';
import { practices } from '../src/practiceStackData';

afterEach(cleanup);

it('renders every practice as struck-through text beside what replaces it', () => {
  const { container } = render(<PracticeStack />);
  const cards = container.querySelectorAll('.practice-card');
  expect(cards).toHaveLength(practices.length);
  cards.forEach((card, index) => {
    expect(card.querySelector('s')?.textContent).toBe(practices[index].replaces);
    expect(card.textContent).toContain(practices[index].artyfact);
  });
});
it('marks partial work and claims nothing outside yes or partial', () => {
  for (const practice of practices) expect(['yes', 'partial']).toContain(practice.status);
  for (const practice of practices.filter(item => item.status === 'partial')) expect(practice.note).toBeTruthy();
  const text = practices.map(practice => practice.artyfact).join(' ');
  expect(text).not.toMatch(/A\/B|experiment|cohort|SLO|incident/i);
});
