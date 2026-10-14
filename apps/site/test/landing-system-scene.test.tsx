import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { LandingStory } from '../src/LandingStory';
import { CheckoutScene } from '../src/LandingSystemScene';
import { checkoutSteps } from '../src/landingSystemData';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('prerenders every step, hides the step buttons and keeps the board fully readable', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToString(<LandingStory />);
  expect(host.querySelectorAll('[data-checkout-step]')).toHaveLength(7);
  expect(host.querySelector('[data-enhanced]')).toBeNull();
  expect((host.querySelector('.checkout-step-buttons') as HTMLElement).hidden).toBe(true);
  for (const step of checkoutSteps) expect(within(host).getByRole('heading', { name: new RegExp(step.title) })).toBeTruthy();
  expect(within(host).getAllByText(/Not measured yet/)).toHaveLength(2);
  expect((host.querySelector('[aria-live="polite"]') as HTMLElement).hidden).toBe(true);
  expect(host.querySelector('.checkout-steps')!.compareDocumentPosition(host.querySelector('.checkout-stage')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(host).getAllByText(/Sample data|illustrative/i).length).toBeGreaterThan(0);
});
it('steps through real buttons with aria-current', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { container } = render(<LandingStory />);
  const buttons = within(screen.getByRole('group', { name: 'Example steps' })).getAllByRole('button');
  expect(buttons).toHaveLength(7);
  expect(buttons[0].getAttribute('aria-current')).toBe('step');
  fireEvent.click(screen.getByRole('button', { name: 'Step 4: Check against the rule' }));
  expect(buttons[3].getAttribute('aria-current')).toBe('step');
  expect(buttons[0].hasAttribute('aria-current')).toBe(false);
  expect(container.querySelector('.checkout-story')?.getAttribute('data-step')).toBe('3');
  expect(container.querySelector('[data-checkout-step="3"]')?.getAttribute('data-active')).toBe('true');
  expect(screen.getByText('Step 4 of 7: Check against the rule').getAttribute('aria-live')).toBe('polite');
});
it('reveals board rows in order', () => {
  const { container, rerender } = render(<CheckoutScene step={0} />);
  const phase = (selector: string) => container.querySelector(selector)?.getAttribute('data-phase');
  expect(phase('.checkout-request')).toBe('current');
  expect(phase('.checkout-overlap')).toBe('next');
  rerender(<CheckoutScene step={4} />);
  expect(phase('.checkout-overlap')).toBe('done');
  expect(phase('.checkout-promote')).toBe('current');
  expect(phase('.checkout-deploy')).toBe('next');
  expect(container.querySelectorAll('.checkout-verdict[data-phase="done"]')).toHaveLength(2);
  expect(container.querySelector('.checkout-promote')?.textContent).toContain('A updated onto B');
});
