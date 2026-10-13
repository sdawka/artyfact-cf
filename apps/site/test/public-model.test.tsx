import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Site } from '../src/pages';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const config = { platform: null, source: null };

it('starts with the domain and lets people choose Things and typed connections', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getByRole('heading', { level: 1, name: /Start with the domain/ })).toBeTruthy();
  expect(screen.getByText(/one or more Things you want to make/)).toBeTruthy();
  expect(screen.getByText(/You choose how to divide the System into Things/i)).toBeTruthy();
  expect(screen.getByText(/within a typed model/i)).toBeTruthy();
  expect(screen.getByText(/Whole contact application/i)).toBeTruthy();
  expect(screen.getByText('Frontend')).toBeTruthy();
});

it('shows form, content and a nested web app ontology without making Parts mandatory', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getByRole('heading', { name: /A Thing has form and content/ })).toBeTruthy();
  expect(screen.getByText(/form gives you criteria/i)).toBeTruthy();
  expect(screen.getByText(/a screen contains a component/i)).toBeTruthy();
  expect(screen.getByText(/Nested subjects are not additional Things or Parts/i)).toBeTruthy();
  expect(screen.getByText(/A Thing can begin with its Genome alone/i)).toBeTruthy();
});

it('separates optional implementation Parts from reusable Rule Pack constraints', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getByText(/Parts carry reusable implementation/i)).toBeTruthy();
  expect(screen.getByText(/Rule Packs check shared constraints/i)).toBeTruthy();
  expect(screen.getByText(/design system can use both/i)).toBeTruthy();
  expect(screen.getByText(/authorization pack checks modeled policy coverage/i)).toBeTruthy();
});

it('labels the proposed Artyfact feature as illustrative across parallel views', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getAllByText('Illustrative target').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Make changes easy to scope and specify/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/proposed acceptance test/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/sample event stream/i)).toBeTruthy();
  expect(screen.getAllByText(/not successive build stages/i).length).toBeGreaterThan(0);
});

it('distinguishes authored source from realized output and keeps evidence claims bounded', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getByText(/Source and each build output keep distinct identities/i)).toBeTruthy();
  expect(screen.getByText(/A passing check establishes only what that check measured/i)).toBeTruthy();
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


it('introduces meaningful systems with a static scroll story and no literal orb', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { container } = render(<Site path="/" config={config} />);
  expect(screen.getByRole('heading', { level: 1, name: /^Make Meaningful Systems$/ })).toBeTruthy();
  expect(screen.getByText('(on Cloudflare)')).toBeTruthy();
  expect(container.querySelector('[data-hero-orb]')).toBe(null);
  expect(container.querySelectorAll('[data-story-step]')).toHaveLength(3);
  expect(screen.getByRole('heading', { name: 'Give the application its shape.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Make that shape tangible.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'See what happens when it functions.' })).toBeTruthy();
});
