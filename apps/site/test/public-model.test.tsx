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
it('maps the agent handoff to its sections and names the real plan commands', () => {
  const { container } = render(<Site path="/connect-agent" config={config} />);
  expect(screen.getByRole('heading', { level: 1, name: 'Bring your agent.' })).toBeTruthy();
  expect(container.querySelector('#start h2')?.textContent).toBe('Start a plan');
  const links = [...container.querySelectorAll<HTMLAnchorElement>('.handoff a')];
  expect(links).toHaveLength(7);
  for (const link of links) expect(container.querySelector(link.getAttribute('href')!)).toBeTruthy();
  expect(links.map(link => link.getAttribute('href'))).toEqual(['#start', '#start', '#work', '#work', '#submit', '#submit', '#review']);
  for (const command of ['plan draft', 'plan tasks', 'plan promote', 'task claim', 'task submit']) expect(container.querySelector('.guide-steps')?.textContent).toContain('artyfact ' + command);
  for (const chip of ['The model, pinned to one version', '15-minute token', 'Any harness']) expect(container.querySelector('.guide-chips')?.textContent).toContain(chip);
  expect(container.querySelector('.guide-chips')?.textContent).not.toContain('TASK_PACKET.md');
  for (const text of ['forks the app’s repo for this Task', 'a fork of the model repo', 'becomes a model delta', 'artyfact evolution propose']) expect(container.querySelector('.guide-steps')?.textContent).toContain(text);
  expect(container.querySelector('.handoff-model')?.textContent).toContain('The model, pinned to one version.');
});


it('introduces the Git platform, the practice stack and the prerendered checkout story', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const { container } = render(<Site path="/" config={config} />);
  expect(screen.getByRole('heading', { level: 1, name: 'The next Git platform keeps track of the product, not just the files.' })).toBeTruthy();
  expect(container.querySelector('[data-hero-orb]')).toBe(null);
  expect(screen.getByRole('heading', { name: 'Give your coding agents the environment to thrive.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'The practices you already use, connected and taken further.' })).toBeTruthy();
  expect(container.querySelector('.practice-stack s')).toBe(null);
  expect(screen.getByRole('link', { name: 'Theory' }).getAttribute('href')).toBe('/model');
  expect(screen.getByRole('heading', { name: 'The clean merge that still breaks checkout.' })).toBeTruthy();
  expect(container.querySelectorAll('[data-checkout-step]')).toHaveLength(7);
  expect(container.querySelector('a[href="/model#lifecycle"]')).toBeTruthy();
});
it('glosses lifecycle terms in plain words and tells a solo developer they are the coordinator', () => {
  const { container } = render(<Site path="/connect-agent" config={config} />);
  const text = container.querySelector('.guide-steps')!.textContent!;
  for (const gloss of ['an Evolution: a proposed change to the model', 'a Realization: a build plan pinned to the accepted model version', 'a candidate: one submitted version', 'make the reviewed result the System’s current state', 'only if nothing changed since the review', 'If you work alone, that is you', 'wrangler secret put ADMIN_TOKEN', 'a plain shell variable you never export', 'shuts out the previous agent']) expect(text).toContain(gloss);
  expect(text).not.toMatch(/fences|rotates its credentials/);
  for (const id of ['prepare', 'start', 'work', 'parts', 'submit', 'review']) expect(container.querySelector('#' + id)?.getAttribute('tabindex')).toBe('-1');
});
it('describes the Task Packet as it is: no purpose or criteria text', () => {
  const { container: model } = render(<Site path="/model" config={config} />);
  for (const text of [...model.querySelectorAll('p')].map(p => p.textContent!).filter(text => /Task Packet carries/.test(text))) expect(text).not.toMatch(/purpose|criteria|claims/);
  cleanup();
  const { container: home } = render(<Site path="/" config={config} />);
  expect(home.querySelector('.environment-columns')!.textContent).not.toMatch(/purpose and the criteria/);
});
