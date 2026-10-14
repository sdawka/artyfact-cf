import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Site } from '../src/pages';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const config = { platform: null, source: null };

it('explains the public page as Theory Driven Development using the real model and three criteria', () => {
  const { container } = render(<Site path="/model" config={config} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Theory Driven Development' })).toBeTruthy();
  expect(container.querySelector('[data-theory-card]')).toBeTruthy();
  expect(container.querySelectorAll('#lifecycle ol > li')).toHaveLength(6);
  expect(container.querySelector('[data-model-subject="component.model-explanation"]')).toBeTruthy();
  expect(screen.getByText('Represent Artyfact accurately')).toBeTruthy();
  expect(screen.getByText('Communicate clearly')).toBeTruthy();
  expect(screen.getByText('Make the visual compelling')).toBeTruthy();
  expect(screen.getByText(/Source can be versioned through Cloudflare Artifacts/)).toBeTruthy();
});
it('preserves optional Parts, Rule Packs and bounded evidence claims', () => {
  render(<Site path="/model" config={config} />);
  expect(screen.getByText(/A Thing can start with its model alone/)).toBeTruthy();
  expect(screen.getByText(/Reusable model content, files and pinned dependencies/)).toBeTruthy();
  expect(screen.getByText(/authorization pack checks modeled policy coverage/)).toBeTruthy();
  expect(screen.getByText(/a passing check establishes only what that check measured/)).toBeTruthy();
  expect(screen.getAllByText(/Measurement in progress/).length).toBeGreaterThan(0);
});

it('documents shipped Parts commands and explicit authoring and review gates', () => {
  render(<Site path="/connect-agent" config={config} />);

  const commands = screen.getByText(/artyfact parts create --id part.my-app/).textContent;
  expect(commands).toContain("\nartyfact parts validate");
  expect(commands).not.toContain("\\n");
  for (const command of ['create', 'validate', 'extract', 'compose', 'upgrade']) expect(commands).toContain(`artyfact parts ${command}`);
  expect(screen.getByText(/These authoring commands preview by default/i)).toBeTruthy();
  expect(screen.getByText(/Accept the Genome through review before starting/i)).toBeTruthy();
  expect(screen.getByText(/--apply --run-commands/)).toBeTruthy();
});


it('introduces the Git platform, the practice stack and the prerendered checkout story', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { container } = render(<Site path="/" config={config} />);
  expect(screen.getByRole('heading', { level: 1, name: 'The next Git platform keeps track of the product, not just the files.' })).toBeTruthy();
  expect(container.querySelector('[data-hero-orb]')).toBe(null);
  expect(screen.getByRole('heading', { name: 'Give your coding agents the environment to thrive.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Stop stitching these together.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'The clean merge that still breaks checkout.' })).toBeTruthy();
  expect(container.querySelectorAll('[data-checkout-step]')).toHaveLength(7);
  expect(container.querySelector('a[href="/model#lifecycle"]')).toBeTruthy();
});
