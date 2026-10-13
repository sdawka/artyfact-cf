import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Site } from '../src/pages';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const config = { platform: null, source: null };

it('explains a Genome-first Thing and optional reusable Parts without treating views as stages', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getByText(/System is the context and governance wrapper/i)).toBeTruthy();
  expect(screen.getAllByText(/A Thing can begin with its Genome alone/i).length).toBeGreaterThan(0);
  expect(screen.getByText(/Parts are optional reusable packages/i)).toBeTruthy();
  expect(screen.getByText(/not successive build stages/i)).toBeTruthy();
});

it('distinguishes authored source from a realized build output and preserves provenance', () => {
  render(<Site path="/model" config={config} />);

  expect(screen.getByText(/Source Artifact is authored code, configuration, assets and manifests/i)).toBeTruthy();
  expect(screen.getByText(/Realized Artifact is one specific build output/i)).toBeTruthy();
  expect(screen.getByText(/its source and Genome lineage/i)).toBeTruthy();
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
  expect(screen.getByRole('heading', { level: 1, name: /Make Meaningful Systems at Scale/ })).toBeTruthy();
  expect(screen.getByText('(on cloudflare)')).toBeTruthy();
  expect(container.querySelector('[data-hero-orb]')).toBe(null);
  expect(container.querySelectorAll('[data-story-step]')).toHaveLength(3);
  expect(screen.getByRole('heading', { name: 'Give the application its shape.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Make that shape tangible.' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'See what happens when it functions.' })).toBeTruthy();
});
